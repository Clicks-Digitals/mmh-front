"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  getOneEpinBalance,
  getOneEpinStatus,
  pingOneEpin,
  refreshOneEpinBalance,
  syncOneEpin,
  type OneEpinBalance,
  type OneEpinStatus,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import Link from "next/link";
import { useState } from "react";

type Tone = "success" | "info" | "warning" | "error";
type PingOutcome = { tone: Tone; message: string; at: string };

const OUTCOME_STYLE: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-900",
  info: "bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]",
  warning: "bg-amber-50 text-amber-950",
  error: "bg-red-50 text-red-900",
};
const OUTCOME_ICON: Record<Tone, string> = { success: "✓", info: "ℹ", warning: "!", error: "✕" };

function isTestMode(mode?: string) {
  return String(mode ?? "mock").toLowerCase() !== "live";
}

function bodyOf(err: unknown): Record<string, unknown> | null {
  return err instanceof ApiError && err.body && typeof err.body === "object"
    ? (err.body as Record<string, unknown>)
    : null;
}

function ConfigBadge({ ok, label }: { ok?: boolean; label: string }) {
  return <Badge tone={ok ? "success" : "warning"}>{`${label}: ${ok ? "set" : "missing"}`}</Badge>;
}

function codeOf(err: unknown): string {
  const body = bodyOf(err);
  return body && typeof body.code === "string" ? body.code : "";
}

export function OneEpinClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const [busy, setBusy] = useState<"ping" | "sync" | "balance" | null>(null);
  const [lastPing, setLastPing] = useState<PingOutcome | null>(null);

  const { data, setData, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const [status, balance] = await Promise.all([
      getOneEpinStatus(tok),
      getOneEpinBalance(tok).catch(() => null),
    ]);
    return { status, balance };
  });

  const status = data?.status ?? null;
  const balance = data?.balance ?? null;

  /** Merge a fresh status object without dropping fields the response may omit. */
  function mergeStatus(next: Partial<OneEpinStatus>) {
    setData((prev) => (prev ? { ...prev, status: { ...prev.status, ...next } } : prev));
  }

  function mergeBalance(next: OneEpinBalance) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            balance: next,
            status: {
              ...prev.status,
              last_balance: next.balance ?? prev.status.last_balance,
              last_balance_currency: next.currency || prev.status.last_balance_currency,
              last_checked_at: next.last_checked_at ?? prev.status.last_checked_at,
            },
          }
        : prev,
    );
  }

  async function ping() {
    if (!token) return;
    setBusy("ping");
    try {
      const result = await pingOneEpin(token);
      const { ok, message, detail, code, ...rest } = result;
      void detail;
      void code;
      mergeStatus(rest);
      const test = isTestMode(rest.mode ?? status?.mode);
      // CA-25: a check in test mode is simulated — say so instead of showing a green tick.
      const tone: Tone = !ok ? "warning" : test ? "info" : "success";
      const text = !ok
        ? message || "The connection check failed."
        : test
          ? `Test mode: the check was simulated, no real connection to OneEpin was made.${message ? ` (${message})` : ""}`
          : message || "Connected to OneEpin.";
      setLastPing({ tone, message: text, at: new Date().toISOString() });
      toast.push(text, tone);
    } catch (err) {
      const body = bodyOf(err);
      if (body) {
        const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !["ok", "message", "detail", "code"].includes(k)));
        mergeStatus(rest as Partial<OneEpinStatus>);
      }
      const notConfigured = codeOf(err) === "not_configured";
      const message = notConfigured
        ? "Not configured: the OneEpin e-mail and password are not set on the server, so nothing was tested. Ask your developer to add them."
        : adminErrorMessage(err, "Connection check failed");
      const tone: Tone = notConfigured ? "warning" : "error";
      setLastPing({ tone, message, at: new Date().toISOString() });
      toast.push(message, tone);
    } finally {
      setBusy(null);
    }
  }

  async function refreshBalance() {
    if (!token) return;
    setBusy("balance");
    try {
      const next = await refreshOneEpinBalance(token);
      mergeBalance(next);
      toast.push(next.message || "Balance refreshed", "success");
    } catch (err) {
      const body = bodyOf(err);
      if (body && "cached" in body) mergeBalance(body as unknown as OneEpinBalance);
      if (codeOf(err) === "test_mode") {
        toast.push("Test mode: OneEpin has no real balance to show. It appears once live purchasing is set up.", "info");
      } else {
        toast.push(adminErrorMessage(err, "Balance refresh failed"), "error");
      }
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    if (!token) return;
    setBusy("sync");
    try {
      const result = await syncOneEpin(token);
      toast.push(result.message || "Catalog sync finished", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = bodyOf(err);
        const msg = body && typeof body.message === "string" && body.message ? body.message : "";
        toast.push(`Sync did not run — nothing to sync in test mode.${msg ? ` (${msg})` : ""} It is recorded in the logs as not completed.`, "info");
      } else {
        toast.push(adminErrorMessage(err, "Sync failed — see OneEpin logs for details."), "error");
      }
    } finally {
      setBusy(null);
    }
  }

  const liveLocked = status?.live_locked !== false;
  const balanceValue = balance?.balance ?? status?.last_balance ?? null;
  const balanceCurrency = balance?.currency || status?.last_balance_currency || "";

  return (
    <div>
      <PageHeader
        title="OneEpin"
        description="Connection to the OneEpin supplier: check the connection, see the balance and sync their catalog."
        actions={
          <Link href="/admin/integrations/1epin/logs" className="admin-btn admin-btn-secondary">
            View logs
          </Link>
        }
      />

      {liveLocked ? (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-[var(--admin-radius)] border border-amber-200 bg-amber-50/80 px-4 py-3">
          <Badge status="LIVE_LOCKED">Live locked</Badge>
          <p className="min-w-0 flex-1 text-[13px] text-amber-950">
            Test mode: no real purchases are made and supplier mappings don&apos;t count as stock. Live purchasing can only be
            switched on by your developer on the server.
          </p>
        </div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? <div className="admin-card h-40 animate-pulse" /> : null}
      {!loading && !error && status ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <AdminCard className="lg:col-span-2" padding="md">
            <AdminSectionHeader
              title="Connection"
              description="Credentials live in server environment variables and are never shown here."
            />
            <div className="flex flex-wrap items-center gap-2">
              {status.mode ? <Badge tone="info">{`Mode: ${String(status.mode).toUpperCase()}`}</Badge> : null}
              {status.environment ? <Badge tone="neutral">{`Env: ${status.environment}`}</Badge> : null}
              <ConfigBadge ok={status.email_configured} label="Email" />
              <ConfigBadge ok={status.password_configured} label="Password" />
              <ConfigBadge ok={status.callback_configured} label="Callback" />
            </div>
            <p className="mt-3 text-[12px] text-[var(--clicks-muted)]">
              Last checked: {formatAdminDateTime(status.last_checked_at)}
            </p>
            {lastPing ? (
              <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-[13px] ${OUTCOME_STYLE[lastPing.tone]}`}>
                {OUTCOME_ICON[lastPing.tone]} {lastPing.message}{" "}
                <span className="text-[11px] opacity-70">({formatAdminDateTime(lastPing.at)})</span>
              </p>
            ) : null}
            {canWrite ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={() => void ping()} className="admin-btn admin-btn-primary">
                  {busy === "ping" ? "Testing…" : "Test connection"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void sync()} className="admin-btn admin-btn-secondary">
                  {busy === "sync" ? "Syncing…" : "Sync catalog"}
                </button>
              </div>
            ) : (
              <p className="mt-4 text-[12px] text-[var(--clicks-muted)]">Your role can view this page but not test or sync the connection.</p>
            )}
          </AdminCard>

          <AdminCard padding="md">
            <AdminSectionHeader title="Balance" description="Cached value from the last refresh." />
            <p className="text-[1.5rem] font-semibold tabular-nums text-[var(--clicks-navy)]">
              {balanceValue ? `${balanceValue} ${balanceCurrency}`.trim() : "—"}
            </p>
            <p className="mt-2 text-[11px] text-[var(--clicks-muted)]">
              {balance?.message || "Balance has not been fetched yet"} · {formatAdminDateTime(balance?.last_checked_at ?? status.last_checked_at)}
            </p>
            {canWrite ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void refreshBalance()}
                className="admin-btn admin-btn-secondary mt-4"
              >
                {busy === "balance" ? "Refreshing…" : "Refresh balance"}
              </button>
            ) : null}
          </AdminCard>
        </div>
      ) : null}
    </div>
  );
}
