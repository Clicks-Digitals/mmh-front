"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { AlertsPanel } from "@/components/admin/oneepin/alerts-panel";
import {
  getBalance,
  getStatus,
  ping,
  refreshBalance,
  syncCatalog,
  type BalanceResult,
  type CatalogSyncResult,
  type OneEpinFullStatus,
  type PingResult,
} from "@/components/admin/oneepin/api";
import { describeFailure, errorBody } from "@/components/admin/oneepin/errors";
import { modeExplanation, modeLabel, resultCodeMessage, supplierAmount } from "@/components/admin/oneepin/labels";
import { CopyButton, OneEpinTabs, OutcomeBox, type Outcome } from "@/components/admin/oneepin/ui";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Info, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type CheckState = "ok" | "warn" | "missing" | "info" | "skip";

const CHECK_ICON: Record<CheckState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: "text-emerald-600", label: "Done" },
  warn: { icon: AlertTriangle, className: "text-amber-600", label: "Needs attention" },
  missing: { icon: XCircle, className: "text-[var(--clicks-error)]", label: "Missing" },
  info: { icon: Info, className: "text-[var(--clicks-blue)]", label: "Info" },
  skip: { icon: CircleDashed, className: "text-[var(--clicks-muted)]", label: "Not needed now" },
};

function CheckRow({ state, title, children }: { state: CheckState; title: string; children?: React.ReactNode }) {
  const { icon: Icon, className, label } = CHECK_ICON[state];
  return (
    <li className="flex gap-3 py-3">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} aria-label={label} />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-medium text-[var(--clicks-navy)]">{title}</p>
        {children ? <div className="mt-0.5 space-y-1.5 text-[12px] leading-relaxed text-[var(--clicks-muted)]">{children}</div> : null}
      </div>
    </li>
  );
}

const CATALOG_STALE_MS = 48 * 3600 * 1000;

function syncSummary(r: Partial<CatalogSyncResult>): string {
  const total = r.total ?? 0;
  const parts = [`${r.created ?? 0} new`, `${r.updated ?? 0} changed`, `${r.deactivated ?? 0} no longer sold`];
  return `${total} product${total === 1 ? "" : "s"} (${parts.join(", ")})`;
}

export function OneEpinOverviewClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const [busy, setBusy] = useState<"ping" | "balance" | "sync" | "ip" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [alertsTick, setAlertsTick] = useState(0);
  const [now] = useState(() => Date.now());

  const { data, setData, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const [status, balance] = await Promise.all([getStatus(tok), getBalance(tok).catch(() => null)]);
    return { status, balance };
  });
  const status = data?.status ?? null;
  const balance = data?.balance ?? null;

  function mergeStatus(next: Partial<OneEpinFullStatus>) {
    setData((prev) => (prev ? { ...prev, status: { ...prev.status, ...next } } : prev));
  }

  function mergeBalance(next: BalanceResult) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            balance: next,
            status: {
              ...prev.status,
              last_balance: next.balance ?? prev.status.last_balance,
              low_balance: next.low_balance ?? prev.status.low_balance,
              last_checked_at: next.last_checked_at ?? prev.status.last_checked_at,
            },
          }
        : prev,
    );
  }

  function report(tone: Outcome["tone"], title: string, message = "") {
    setOutcome({ tone, title, message, at: new Date().toISOString() });
    toast.push(message ? `${title} ${message}` : title, tone);
  }

  async function runPing() {
    if (!token) return;
    setBusy("ping");
    try {
      const result: PingResult = await ping(token);
      const { ok, message, code, detail, ...rest } = result;
      void detail;
      mergeStatus(rest);
      const mock = (rest.mode ?? status?.mode) === "mock";
      if (!ok) report("error", "Connection test failed.", resultCodeMessage(code, message || ""));
      else if (mock) report("info", "Mock mode: the built-in simulator answered.", "No real connection to 1Epin was made.");
      else report("success", "Connected to 1Epin.", message && message !== "Success" ? message : "1Epin accepted our server and login.");
    } catch (err) {
      const body = errorBody(err);
      if (body) {
        const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !["ok", "message", "detail", "code"].includes(k)));
        mergeStatus(rest as Partial<OneEpinFullStatus>);
      }
      report("error", "Connection test failed.", describeFailure(err, "Try again in a minute."));
    } finally {
      setBusy(null);
    }
  }

  async function runBalance() {
    if (!token) return;
    setBusy("balance");
    try {
      const next = await refreshBalance(token);
      mergeBalance(next);
      report(
        next.low_balance ? "warning" : "success",
        `Balance: ${supplierAmount(next.balance, next.currency)}.`,
        next.low_balance ? "That is below the low-balance warning level — top up 1Epin soon." : "",
      );
      setAlertsTick((n) => n + 1);
    } catch (err) {
      const body = errorBody(err);
      if (body && "cached" in body) mergeBalance(body as unknown as BalanceResult);
      report("error", "Could not refresh the balance.", describeFailure(err, "Try again in a minute."));
    } finally {
      setBusy(null);
    }
  }

  async function runSync() {
    if (!token) return;
    setBusy("sync");
    try {
      const r = await syncCatalog(token);
      report(
        "success",
        `Catalog synced: ${syncSummary(r)}.`,
        r.price_alerts ? `${r.price_alerts} linked product price${r.price_alerts === 1 ? "" : "s"} changed by more than 10% — see alerts below.` : "",
      );
      reload();
      setAlertsTick((n) => n + 1);
    } catch (err) {
      report("error", "Catalog sync did not run.", describeFailure(err, "Try again in a minute."));
    } finally {
      setBusy(null);
    }
  }

  async function recheckIp() {
    if (!token) return;
    setBusy("ip");
    try {
      mergeStatus(await getStatus(token, { refreshIp: true }));
    } catch (err) {
      toast.push(describeFailure(err, "Could not look up the IP."), "error");
    } finally {
      setBusy(null);
    }
  }

  const mode = (status?.mode ?? "").toLowerCase();
  const mock = mode === "mock";
  const balanceValue = balance?.balance ?? status?.balance?.amount ?? status?.last_balance ?? null;
  const balanceCurrency = balance?.currency || status?.balance?.currency || status?.currency || "";
  const balanceAt = balance?.last_checked_at ?? status?.balance?.checked_at ?? status?.last_checked_at ?? null;
  const lastSync = status?.last_catalog_sync ?? null;
  const syncStale = !lastSync || now - new Date(lastSync).getTime() > CATALOG_STALE_MS;
  const settingsUrl = status?.api_settings_url || "https://www.1epin.com/api-ayarlari";

  return (
    <div>
      <PageHeader
        title="1Epin"
        description="1Epin is the supplier that delivers codes and top-ups when we have none of our own. This page shows what is set up, the wallet balance and anything that needs attention."
      />
      <OneEpinTabs />

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <div className="admin-card h-48 animate-pulse" /> : null}

      {status ? (
        <>
          <div
            className={cn(
              "mb-4 rounded-[var(--admin-radius)] border px-4 py-3 text-[13px]",
              mode === "live" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50/80 text-amber-950",
            )}
          >
            <p className="font-semibold">Mode: {modeLabel(status.mode)}</p>
            <p className="mt-0.5">{modeExplanation(status.mode)}</p>
            {status.trading_enabled === false && status.trading_disabled_reason ? (
              <p className="mt-1 text-[12px] opacity-80">Buying from 1Epin is off: {status.trading_disabled_reason}</p>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <AdminCard className="lg:col-span-2" padding="md">
              <AdminSectionHeader
                title="Setup checklist"
                description="What is done and what is still missing. Passwords and secrets live on the server and are never shown here."
              />
              <ul className="divide-y divide-[var(--clicks-border)]">
                <CheckRow state="info" title={`Mode: ${modeLabel(status.mode)}`}>
                  <p>
                    Mock = practice with a simulator · Test = 1Epin&apos;s test server, no real money · Live = real purchases. Your
                    developer changes the mode on the server.
                  </p>
                </CheckRow>

                <CheckRow
                  state={status.credentials_configured ? "ok" : mock ? "skip" : "missing"}
                  title={status.credentials_configured ? "1Epin account login is set" : "1Epin account login is missing"}
                >
                  <p>
                    {status.credentials_configured
                      ? "The 1Epin email and password are saved on the server."
                      : mock
                        ? "Not needed in mock mode. Before switching to Test or Live, your developer must set ONEEPIN_EMAIL and ONEEPIN_PASSWORD on the server."
                        : "Ask your developer to set ONEEPIN_EMAIL and ONEEPIN_PASSWORD on the server. Nothing can be bought until then."}
                  </p>
                </CheckRow>

                <CheckRow
                  state={mock ? "skip" : status.outgoing_ip ? "warn" : "missing"}
                  title={status.outgoing_ip ? `Our outgoing IP: ${status.outgoing_ip}` : "Outgoing IP not known yet"}
                >
                  <p>
                    1Epin only accepts requests from IP addresses registered on their API Settings page. If “Test connection”
                    says the IP was rejected (code 02), register this IP there.
                    {status.proxy_configured ? " Requests go through the configured fixed-IP proxy." : ""}
                  </p>
                  {status.outgoing_ip_error ? <p className="text-amber-700">{status.outgoing_ip_error}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {status.outgoing_ip ? <CopyButton value={status.outgoing_ip} label="Copy IP" /> : null}
                    <a
                      href={settingsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--clicks-blue)]"
                    >
                      Register this IP on 1Epin API Settings <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-[var(--clicks-blue)] disabled:opacity-50"
                      disabled={busy === "ip"}
                      onClick={() => void recheckIp()}
                    >
                      {busy === "ip" ? "Checking…" : "Check the IP again"}
                    </button>
                  </div>
                  {status.outgoing_ip_checked_at ? <p>Checked {formatAdminDateTime(status.outgoing_ip_checked_at)}.</p> : null}
                </CheckRow>

                <CheckRow
                  state={status.callback_token_configured ? (canWrite ? "warn" : "ok") : mock ? "skip" : "missing"}
                  title={status.callback_token_configured ? "Callback address" : "Callback address is not set up"}
                >
                  {status.callback_token_configured ? (
                    canWrite ? (
                      <>
                        <p>
                          1Epin calls this address when an order finishes, so customers get their codes faster. Paste it into the
                          “Callback URL” box on the same 1Epin API Settings page. Keep it private — it contains a secret.
                        </p>
                        {status.callback_url ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="break-all rounded bg-[#F3F5F9] px-2 py-1 font-mono text-[11px] text-[var(--clicks-navy)]">
                              {status.callback_url}
                            </code>
                            <CopyButton value={status.callback_url} label="Copy URL" />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p>Set up on the server. Only staff who can change supplier settings can see the address.</p>
                    )
                  ) : (
                    <p>
                      Ask your developer to set ONEEPIN_CALLBACK_TOKEN. Without it orders still complete, just a little slower (we
                      check them every few minutes).
                    </p>
                  )}
                </CheckRow>

                <CheckRow
                  state={status.live_enabled ? "ok" : "info"}
                  title={status.live_enabled ? "Live purchasing is switched on" : "Live purchasing is switched off"}
                >
                  <p>
                    {status.live_enabled
                      ? "Real orders are paid from the 1Epin wallet."
                      : "Real purchases need SUPPLIER_MODE=live and ONEEPIN_ALLOW_LIVE=true on the server (both)."}
                  </p>
                  <p>
                    Buying from 1Epin right now: <strong>{status.trading_enabled ? "yes" : "no"}</strong>
                    {!status.trading_enabled && status.trading_disabled_reason ? ` — ${status.trading_disabled_reason}` : ""}.
                    {" "}Linked products count as stock: <strong>{status.mappings_count_as_stock ? "yes" : "no"}</strong>.
                  </p>
                  <p className="text-[12px] text-[var(--clicks-muted)]">
                    {status.mode === "mock"
                      ? "Mock mode on a development computer: a product linked to 1Epin can be bought even with no codes of our own — the simulator delivers practice codes."
                      : status.mode === "test"
                        ? "Test mode: linked products count as stock only when ONEEPIN_TEST_COUNTS_AS_STOCK=true (for rehearsals on staging)."
                        : "Live mode: linked products count as stock while “Buy automatically” is on and the catalog was synced in the last 48 hours."}
                  </p>
                </CheckRow>

                <CheckRow
                  state={!lastSync ? "missing" : syncStale ? "warn" : "ok"}
                  title={lastSync ? `Catalog synced ${formatAdminDateTime(lastSync)}` : "The 1Epin catalog has never been synced"}
                >
                  <p>
                    {status.catalog_items ?? 0} 1Epin products are available to link.
                    {syncStale
                      ? " Sync at least every 48 hours, otherwise linked products stop counting as stock. It also runs automatically once a day."
                      : ""}
                  </p>
                  <Link href="/admin/integrations/1epin/catalog" className="text-[12px] font-semibold text-[var(--clicks-blue)]">
                    Open the 1Epin catalog
                  </Link>
                </CheckRow>

                <CheckRow
                  state={(status.mappings ?? 0) > 0 ? "ok" : "missing"}
                  title={`${status.mappings ?? 0} product option${status.mappings === 1 ? "" : "s"} linked to 1Epin`}
                >
                  <p>Only linked product options are bought from 1Epin. Link them from the catalog or the product&apos;s Supplier tab.</p>
                  <Link href="/admin/integrations/1epin/mappings" className="text-[12px] font-semibold text-[var(--clicks-blue)]">
                    See linked products
                  </Link>
                </CheckRow>

                <CheckRow
                  state={!balanceValue ? (mock ? "skip" : "missing") : status.low_balance ? "warn" : "ok"}
                  title={balanceValue ? `Balance ${supplierAmount(balanceValue, balanceCurrency)}` : "Balance not checked yet"}
                >
                  <p>
                    {status.low_balance
                      ? `Below the warning level (${status.low_balance_threshold} ${balanceCurrency}). Orders fail when the wallet runs out.`
                      : "Refresh it after topping up the 1Epin wallet."}
                  </p>
                </CheckRow>
              </ul>
            </AdminCard>

            <div className="space-y-3">
              <AdminCard padding="md">
                <AdminSectionHeader title="1Epin wallet" description="Money available for buying from 1Epin." />
                <p
                  className={cn(
                    "text-[1.5rem] font-semibold tabular-nums",
                    status.low_balance ? "text-amber-700" : "text-[var(--clicks-navy)]",
                  )}
                >
                  {balanceValue ? supplierAmount(balanceValue, balanceCurrency) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
                  {balanceAt ? `Checked ${formatAdminDateTime(balanceAt)}` : "Not checked yet"}
                </p>
                {status.low_balance ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
                    Low balance — below {status.low_balance_threshold} {balanceCurrency}. Top up 1Epin so orders don&apos;t fail.
                  </p>
                ) : null}
                {status.fx_to_jod ? (
                  <p className="mt-2 text-[11px] text-[var(--clicks-muted)]">
                    Costs are converted at 1 {status.currency || "USD"} = {status.fx_to_jod} JOD.
                  </p>
                ) : null}
                {canWrite ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runBalance()}
                    className="admin-btn admin-btn-secondary mt-3"
                  >
                    {busy === "balance" ? "Refreshing…" : "Refresh balance"}
                  </button>
                ) : null}
              </AdminCard>

              <AdminCard padding="md">
                <AdminSectionHeader title="1Epin orders" />
                <ul className="space-y-1.5 text-[13px]">
                  <li>
                    <Link
                      href="/admin/integrations/1epin/orders?needs_review=1"
                      className={cn("font-medium", (status.orders_manual_review ?? 0) > 0 ? "text-amber-700" : "text-[var(--clicks-blue)]")}
                    >
                      {status.orders_manual_review ?? 0} order{(status.orders_manual_review ?? 0) === 1 ? "" : "s"} need review
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/admin/integrations/1epin/orders?status=NOT_SUBMITTED,SUBMITTING,PROCESSING,WAITING,UNKNOWN"
                      className="font-medium text-[var(--clicks-blue)]"
                    >
                      {status.orders_in_flight ?? 0} in progress
                    </Link>
                  </li>
                </ul>
              </AdminCard>
            </div>
          </div>

          <AdminCard padding="md" className="mt-3">
            <AdminSectionHeader
              title="Actions"
              description="Test connection checks our login and IP with 1Epin. Sync catalog downloads 1Epin's product list and prices (also runs daily)."
            />
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={() => void runPing()} className="admin-btn admin-btn-primary">
                  {busy === "ping" ? "Testing…" : "Test connection"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void runBalance()} className="admin-btn admin-btn-secondary">
                  {busy === "balance" ? "Refreshing…" : "Refresh balance"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void runSync()} className="admin-btn admin-btn-secondary">
                  {busy === "sync" ? "Syncing…" : "Sync catalog"}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--clicks-muted)]">Your role can view 1Epin but not test, refresh or sync it.</p>
            )}
            {outcome ? (
              <div className="mt-3">
                <OutcomeBox outcome={outcome} />
                <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
                  {formatAdminDateTime(outcome.at)} ·{" "}
                  <Link href="/admin/integrations/1epin/logs" className="font-semibold text-[var(--clicks-blue)]">
                    See the logs
                  </Link>
                </p>
              </div>
            ) : null}
          </AdminCard>

          <AlertsPanel
            className="mt-3"
            reloadKey={alertsTick}
            onChanged={(open) => mergeStatus({ open_alerts: open })}
          />
        </>
      ) : null}
    </div>
  );
}
