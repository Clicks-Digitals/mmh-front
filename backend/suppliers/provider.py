from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass

from django.conf import settings
from django.utils import timezone

from suppliers.models import Supplier, SupplierApiLog, SupplierConnection, SupplierEnvironment


LIVE_DISABLED_MESSAGE = "Live 1Epin is disabled in this phase."


@dataclass
class BalanceResult:
    amount: str
    currency: str
    message: str
    ok: bool


class SupplierError(RuntimeError):
    pass


def assert_live_locked() -> None:
    if settings.SUPPLIER_MODE == "live" or settings.ONEEPIN_ALLOW_LIVE:
        raise SupplierError(LIVE_DISABLED_MESSAGE)


class MockSupplierProvider:
    def check_connection(self) -> dict:
        return {"ok": True, "mode": "mock", "message": "Mock Mode — 1Epin is not live."}

    def get_balance(self) -> BalanceResult:
        return BalanceResult(amount="0.00", currency="USD", message="Mock balance", ok=True)

    def sync_catalog(self) -> dict:
        # Nothing is imported in mock mode; report a no-op instead of a false success.
        return {"ok": False, "noop": True, "imported": 0, "message": "Mock mode: there is no remote catalog to sync"}


class OneEpinProvider:
    def __init__(self):
        assert_live_locked()
        if settings.SUPPLIER_MODE == "live":
            raise SupplierError(LIVE_DISABLED_MESSAGE)
        self.base_url = settings.ONEEPIN_TEST_BASE_URL
        self.email = settings.ONEEPIN_EMAIL
        self.password = settings.ONEEPIN_PASSWORD
        self.timeout = settings.ONEEPIN_REQUEST_TIMEOUT_MS / 1000

    def _post(self, path: str, payload: dict) -> dict:
        url = self.base_url.rstrip("/") + "/" + path.lstrip("/")
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
                return data
        except urllib.error.HTTPError as exc:
            raise SupplierError(f"1Epin HTTP {exc.code}") from exc
        except Exception as exc:  # noqa: BLE001
            raise SupplierError(str(exc)) from exc

    def check_connection(self) -> dict:
        if not self.email or not self.password:
            return {"ok": False, "mode": "test", "message": "1Epin credentials not configured"}
        try:
            bal = self.get_balance()
            return {"ok": bal.ok, "mode": "test", "message": bal.message}
        except SupplierError as exc:
            return {"ok": False, "mode": "test", "message": str(exc)}

    def get_balance(self) -> BalanceResult:
        data = self._post("GetBalance", {"Email": self.email, "Password": self.password})
        code = str(data.get("ResultCode", ""))
        ok = code == "00"
        return BalanceResult(
            amount=str(data.get("Balance", "0")),
            currency="USD",
            message=str(data.get("ResultMessage", "")),
            ok=ok,
        )

    def sync_catalog(self) -> dict:
        return {
            "ok": False,
            "noop": True,
            "imported": 0,
            "message": "Catalog sync requires mapped 1Epin endpoints; use admin tools later",
        }


def get_supplier_provider():
    mode = settings.SUPPLIER_MODE
    if mode == "live":
        raise SupplierError(LIVE_DISABLED_MESSAGE)
    if mode == "test":
        return OneEpinProvider()
    return MockSupplierProvider()


def ensure_mock_supplier() -> Supplier:
    supplier, _ = Supplier.objects.get_or_create(slug="1epin", defaults={"name": "1Epin"})
    env = SupplierEnvironment.MOCK
    if settings.SUPPLIER_MODE == "test":
        env = SupplierEnvironment.TEST
    connection, _ = SupplierConnection.objects.get_or_create(
        supplier=supplier,
        defaults={
            "environment": env,
            "base_url": settings.ONEEPIN_TEST_BASE_URL,
            "email_configured": bool(settings.ONEEPIN_EMAIL),
            "password_configured": bool(settings.ONEEPIN_PASSWORD),
            "callback_configured": bool(settings.ONEEPIN_CALLBACK_TOKEN),
        },
    )
    connection.environment = env
    connection.email_configured = bool(settings.ONEEPIN_EMAIL)
    connection.password_configured = bool(settings.ONEEPIN_PASSWORD)
    connection.callback_configured = bool(settings.ONEEPIN_CALLBACK_TOKEN)
    connection.save()
    return supplier


def log_supplier_action(supplier: Supplier, action: str, ok: bool, message: str = "", status_code: int | None = None):
    SupplierApiLog.objects.create(
        supplier=supplier,
        action=action,
        ok=ok,
        status_code=status_code,
        message=message,
    )
