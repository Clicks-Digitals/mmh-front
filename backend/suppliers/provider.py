"""1Epin API client (official doc v1.0.5) with a pluggable HTTP transport.

* Every call is ``POST <base>/<method>/`` with a JSON body that carries ``emailAddress`` and
  ``password``; every response has ``ResultCode`` (``"00"`` = success) and ``ResultMessage``.
* ``UrllibTransport`` talks to the network (optional ``ONEEPIN_HTTP_PROXY`` for a static egress IP).
* ``MockTransport`` simulates 1Epin (deterministic catalog, balance and orders with fake PINs) so
  the whole flow runs locally; tests inject their own fake transport via :func:`override_transport`.

Security: the password is never logged; API logs keep method, ok, ResultCode, message, duration and
orderNumber only. PinCodes never leave this module unmasked except to the caller that encrypts them.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from django.conf import settings

from suppliers.models import Supplier, SupplierApiLog, SupplierConnection, SupplierEnvironment

logger = logging.getLogger("suppliers")

LIVE_DISABLED_MESSAGE = "Live 1Epin is disabled: set SUPPLIER_MODE=live and ONEEPIN_ALLOW_LIVE=true."
SUPPLIER_SLUG = "1epin"
MOCK_CONNECTION_MESSAGE = "Simulator — no real 1Epin connection"

RESULT_MESSAGES = {
    "00": "Success",
    "01": "Missing parameter",
    "02": "Unauthorized IP address (register the server's outgoing IP on 1Epin API settings)",
    "03": "Unknown or invalid 1Epin user (check ONEEPIN_EMAIL / ONEEPIN_PASSWORD)",
    "04": "Not enough 1Epin balance",
    "05": "Category not found",
    "06": "Product not found at 1Epin",
    "07": "Order number already registered at 1Epin",
    "08": "Order not found at 1Epin",
    "09": "This is a top-up product: a player id is required",
    "10": "1Epin service window (23:45-00:00); retried automatically",
    "11": "Product is not available for sale via the API",
    "12": "A valid barem (amount) is required for this tiered product",
    "13": "Barem is out of range",
    "14": "Barem must be a whole number",
    "15": "Product does not accept a barem",
    "16": "Maximum quantity exceeded",
    "17": "Minimum quantity not met",
}

# checkOrder ``OrderStatusMessage`` values (failed orders) in plain English for staff. The raw value
# stays in the stored response / ``raw_reason`` so nothing is lost.
ORDER_STATUS_MESSAGES = {
    "wrong_player_id": "Wrong player ID - 1Epin could not find this game account",
    "wrong_user_id": "Wrong player ID - 1Epin could not find this game account",
    "invalid_player_id": "Wrong player ID - 1Epin could not find this game account",
    "player_not_found": "Wrong player ID - 1Epin could not find this game account",
    "wrong_zone_id": "Wrong zone / server ID for this game account",
    "wrong_server_id": "Wrong zone / server ID for this game account",
    "wrong_region": "The game account is in a region this product does not support",
    "region_mismatch": "The game account is in a region this product does not support",
    "out_of_stock": "1Epin is out of stock for this product",
    "no_stock": "1Epin is out of stock for this product",
    "no_balance": "Not enough 1Epin balance",
    "insufficient_balance": "Not enough 1Epin balance",
    "timeout": "The game publisher did not answer in time",
    "cancelled": "1Epin cancelled the order",
    "canceled": "1Epin cancelled the order",
    "refunded": "1Epin refunded the order",
    "failed": "1Epin could not complete the order",
}

# Result codes whose 1Epin ResultMessage carries useful details (e.g. the refused IP address).
KEEP_RAW_MESSAGE_CODES = {"02"}


def readable_order_status(raw: Any) -> str:
    """``wrong_player_id`` -> "Wrong player ID - ..."; unknown values are tidied up, never dropped."""
    text = str(raw or "").strip()
    if not text:
        return "1Epin could not complete the order"
    key = text.lower().replace("-", "_").replace(" ", "_")
    if key in ORDER_STATUS_MESSAGES:
        return ORDER_STATUS_MESSAGES[key]
    tidy = text.replace("_", " ").strip()
    return (tidy[:1].upper() + tidy[1:])[:200]


class SupplierError(RuntimeError):
    pass


class TransportError(Exception):
    """Network failure, timeout, non-2xx HTTP status or a non-JSON body."""

    def __init__(self, message: str, *, http_status: int | None = None):
        super().__init__(message)
        self.http_status = http_status


@dataclass
class BalanceResult:
    amount: str
    currency: str
    message: str
    ok: bool
    code: str = ""


@dataclass
class OneEpinResult:
    method: str
    code: str = ""
    message: str = ""
    data: dict = field(default_factory=dict)
    network_error: str = ""
    http_status: int | None = None
    duration_ms: int = 0

    @property
    def ok(self) -> bool:
        return not self.network_error and self.code == "00"

    @property
    def readable(self) -> str:
        if self.network_error:
            return f"Could not reach 1Epin: {self.network_error}"
        base = RESULT_MESSAGES.get(self.code, "")
        if (
            self.code in KEEP_RAW_MESSAGE_CODES
            and self.message
            and base
            and self.message.lower() not in base.lower()
        ):
            return f"{base} ({self.message})"[:480]
        return (base or self.message or f"1Epin result {self.code}")[:480]

    @property
    def log_message(self) -> str:
        """Message for the API log: the order outcome for addOrder/checkOrder, not just "Success"."""
        if not self.ok:
            return self.readable
        if self.method == "addOrder":
            return "Order accepted by 1Epin"
        if self.method == "checkOrder":
            try:
                status_code = int(self.data.get("OrderStatusCode"))
            except (TypeError, ValueError):
                status_code = None
            if status_code == 1:
                pins = self.data.get("PinCodes") or []
                count = len(pins) if isinstance(pins, list) else 0
                return f"Order completed ({count} PIN(s))" if count else "Order completed"
            if status_code == 2:
                return f"Order failed: {readable_order_status(self.data.get('OrderStatusMessage'))}"[:480]
            if status_code == 0:
                return "Order still processing at 1Epin"
        return self.message or "Success"


def normalize_code(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    if text.isdigit() and len(text) < 2:
        return text.zfill(2)
    return text


def to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def mask_pin(pin: str) -> str:
    from commerce.crypto import mask_code

    return mask_code(str(pin or ""))


def sanitize_payload(data: dict) -> dict:
    """Copy safe for storage/logs: no credentials, PinCodes masked."""
    out: dict = {}
    for key, value in (data or {}).items():
        lower = str(key).lower()
        if lower in {"password", "emailaddress"}:
            continue
        if lower == "pincodes" and isinstance(value, list):
            out[key] = [mask_pin(v) for v in value]
            continue
        out[key] = value
    return out


# --- Transports ------------------------------------------------------------------------


class UrllibTransport:
    def __init__(self, proxy: str = ""):
        handlers: list = []
        if proxy:
            handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        self._opener = urllib.request.build_opener(*handlers)

    def _open(self, req, timeout: float) -> dict:
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            raise TransportError(f"HTTP {exc.code}", http_status=exc.code) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise TransportError(f"{exc.__class__.__name__}: {reason}"[:200]) from None
        try:
            data = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise TransportError("Invalid JSON response") from None
        if not isinstance(data, dict):
            raise TransportError("Unexpected response shape")
        return data

    def post_json(self, url: str, payload: dict, timeout: float) -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST"
        )
        return self._open(req, timeout)

    def get_json(self, url: str, timeout: float) -> dict:
        req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
        return self._open(req, timeout)


MOCK_START_BALANCE = Decimal("1000.00")
MOCK_MAX_QUANTITY = 50
MOCK_CATALOG: list[dict] = [
    {"CategoryId": 1, "CategoryName": "PUBG Mobile UC", "CategoryType": "epin", "ProductId": 101, "ProductName": "PUBG Mobile 60 UC", "ProductPrice": 0.89},
    {"CategoryId": 1, "CategoryName": "PUBG Mobile UC", "CategoryType": "epin", "ProductId": 102, "ProductName": "PUBG Mobile 325 UC", "ProductPrice": 4.45},
    {"CategoryId": 1, "CategoryName": "PUBG Mobile UC", "CategoryType": "epin", "ProductId": 103, "ProductName": "PUBG Mobile 660 UC", "ProductPrice": 8.90},
    {"CategoryId": 2, "CategoryName": "Free Fire", "CategoryType": "topup", "ProductId": 201, "ProductName": "Free Fire 100 Diamonds", "ProductPrice": 0.95},
    {"CategoryId": 2, "CategoryName": "Free Fire", "CategoryType": "topup", "ProductId": 202, "ProductName": "Free Fire 530 Diamonds", "ProductPrice": 4.60},
    {"CategoryId": 3, "CategoryName": "Mobile Legends", "CategoryType": "topup", "ProductId": 301, "ProductName": "Mobile Legends 86 Diamonds", "ProductPrice": 1.40},
    {"CategoryId": 3, "CategoryName": "Mobile Legends", "CategoryType": "topup", "ProductId": 302, "ProductName": "Mobile Legends 172 Diamonds", "ProductPrice": 2.80},
    {"CategoryId": 4, "CategoryName": "Razer Gold", "CategoryType": "epin", "ProductId": 401, "ProductName": "Razer Gold 5 USD", "ProductPrice": 4.95},
    {"CategoryId": 4, "CategoryName": "Razer Gold", "CategoryType": "epin", "ProductId": 402, "ProductName": "Razer Gold 10 USD", "ProductPrice": 9.85},
    {"CategoryId": 5, "CategoryName": "iTunes US", "CategoryType": "epin", "ProductId": 501, "ProductName": "iTunes 10 USD", "ProductPrice": 9.60},
    {"CategoryId": 8, "CategoryName": "MMH mock scenarios (top-up)", "CategoryType": "topup", "ProductId": 9001, "ProductName": "Mock top-up - always fails (wrong_player_id)", "ProductPrice": 0.50},
    {"CategoryId": 9, "CategoryName": "MMH mock scenarios (e-pin)", "CategoryType": "epin", "ProductId": 9002, "ProductName": "Mock slow e-pin (completes 60 s after ordering)", "ProductPrice": 0.50},
]
MOCK_SLOW_SECONDS = 60


class MockTransport:
    """Simulated 1Epin. State lives in our own SupplierOrder rows (environment MOCK)."""

    def _product(self, product_id) -> dict | None:
        for row in MOCK_CATALOG:
            if str(row["ProductId"]) == str(product_id):
                return row
        return None

    def _order(self, order_number: str):
        from suppliers.models import SupplierOrder

        return SupplierOrder.objects.filter(
            supplier_ref=str(order_number), environment=SupplierEnvironment.MOCK, placed=True
        ).first()

    def _balance(self) -> Decimal:
        from django.db.models import Sum

        from suppliers.models import SupplierOrder

        spent = (
            SupplierOrder.objects.filter(environment=SupplierEnvironment.MOCK, placed=True)
            .exclude(order_status_code=2)
            .aggregate(s=Sum("cost"))["s"]
            or Decimal("0")
        )
        return (MOCK_START_BALANCE - spent).quantize(Decimal("0.01"))

    @staticmethod
    def _ok(**extra) -> dict:
        return {"ResultCode": "00", "ResultMessage": "Success", **extra}

    @staticmethod
    def _err(code: str, message: str) -> dict:
        return {"ResultCode": code, "ResultMessage": message}

    def post_json(self, url: str, payload: dict, timeout: float) -> dict:
        method = url.rstrip("/").rsplit("/", 1)[-1]
        if method == "checkBalance":
            return self._ok(Balance=float(self._balance()))
        if method in {"categories", "categoryInfo"}:
            seen: dict[int, dict] = {}
            for row in MOCK_CATALOG:
                seen.setdefault(
                    row["CategoryId"],
                    {"CategoryId": row["CategoryId"], "CategoryName": row["CategoryName"], "CategoryType": row["CategoryType"]},
                )
            return self._ok(Categories=list(seen.values()))
        if method == "products":
            rows = [r for r in MOCK_CATALOG if str(r["CategoryId"]) == str(payload.get("category"))]
            if not rows:
                return self._err("05", "Category Not Found")
            return self._ok(
                Products=[
                    {"ProductId": r["ProductId"], "ProductName": r["ProductName"], "ProductPrice": r["ProductPrice"]}
                    for r in rows
                ]
            )
        if method == "allProducts":
            return self._ok(Products=[dict(r) for r in MOCK_CATALOG])
        if method == "addOrder":
            return self._add_order(payload)
        if method == "checkOrder":
            return self._check_order(payload)
        return self._err("01", "Missing Parameter")

    def _add_order(self, payload: dict) -> dict:
        order_number = str(payload.get("orderNumber") or "")
        if not order_number or not payload.get("product"):
            return self._err("01", "Missing Parameter")
        product = self._product(payload.get("product"))
        if product is None:
            return self._err("06", "Product Not Found")
        if product["CategoryType"] == "topup" and not str(payload.get("user") or "").strip():
            return self._err("09", "Product type is popup, must send user")
        if "barem" in payload:
            return self._err("15", "Product does not accept barem")
        quantity = int(payload.get("quantity") or 1)
        if quantity < 1:
            return self._err("17", "Min quantity not met")
        if quantity > MOCK_MAX_QUANTITY:
            return self._err("16", "Max quantity exceeded")
        if self._order(order_number) is not None:
            return self._err("07", "Registered OrderNumber")
        cost = Decimal(str(product["ProductPrice"])) * quantity
        balance = self._balance()
        if cost > balance:
            return self._err("04", "No Balance")
        return self._ok(Balance=float((balance - cost).quantize(Decimal("0.01"))))

    def _check_order(self, payload: dict) -> dict:
        from django.utils import timezone

        order_number = str(payload.get("orderNumber") or "")
        order = self._order(order_number)
        if order is None:
            return self._err("08", "Order Not Found")
        product = self._product(order.external_product_id) or {}
        amount = float(Decimal(str(product.get("ProductPrice", 0))) * max(order.quantity, 1))
        if str(order.external_product_id) == "9001" or (order.kind == "topup" and order.player_user.strip() == "000000"):
            return self._ok(OrderStatusCode=2, OrderStatusMessage="wrong_player_id", PinCodes=[], OrderAmount=amount)
        if str(order.external_product_id) == "9002":
            started = order.submitted_at or order.created_at
            if started and (timezone.now() - started).total_seconds() < MOCK_SLOW_SECONDS:
                return self._ok(OrderStatusCode=0, OrderStatusMessage="Processing", PinCodes=[], OrderAmount=amount)
        pins: list[str] = []
        if product.get("CategoryType", "epin") != "topup":
            for i in range(order.quantity):
                digest = hashlib.sha256(f"mock-pin:{order_number}:{i}".encode()).hexdigest().upper()
                pins.append(f"MOCK-{digest[:4]}-{digest[4:8]}-{digest[8:12]}")
        return self._ok(OrderStatusCode=1, OrderStatusMessage="Completed", PinCodes=pins, OrderAmount=amount)

    def get_json(self, url: str, timeout: float) -> dict:
        raise TransportError("The mock transport has no internet access")


_transport_override: Any = None


@contextlib.contextmanager
def override_transport(transport):
    """Use ``transport`` for every provider built inside the block (tests / tooling)."""
    global _transport_override
    previous = _transport_override
    _transport_override = transport
    try:
        yield transport
    finally:
        _transport_override = previous


def default_transport(environment: str):
    if _transport_override is not None:
        return _transport_override
    if environment == SupplierEnvironment.MOCK:
        return MockTransport()
    return UrllibTransport(proxy=getattr(settings, "ONEEPIN_HTTP_PROXY", ""))


# --- Client ------------------------------------------------------------------------------


class OneEpinClient:
    def __init__(
        self,
        *,
        base_url: str,
        email: str,
        password: str,
        transport,
        timeout: float,
        environment: str,
        log: Callable[[OneEpinResult, str], None] | None = None,
    ):
        self.base_url = base_url.rstrip("/") + "/"
        self._email = email
        self._password = password
        self.transport = transport
        self.timeout = timeout
        self.environment = environment
        self._log = log

    def call(self, method: str, params: dict | None = None, *, order_number: str = "") -> OneEpinResult:
        body = {"emailAddress": self._email, "password": self._password, **(params or {})}
        url = f"{self.base_url}{method}/"
        started = time.monotonic()
        result = OneEpinResult(method=method)
        try:
            data = self.transport.post_json(url, body, self.timeout)
        except TransportError as exc:
            result.network_error = str(exc) or "network error"
            result.http_status = exc.http_status
        except Exception as exc:  # noqa: BLE001 - any transport failure is "unknown", never a crash
            result.network_error = f"{exc.__class__.__name__}"
        else:
            result.data = data if isinstance(data, dict) else {}
            result.code = normalize_code(result.data.get("ResultCode"))
            result.message = str(result.data.get("ResultMessage") or "")[:300]
            if not result.code:
                result.network_error = "Response without ResultCode"
        result.duration_ms = int((time.monotonic() - started) * 1000)
        if self._log is not None:
            try:
                self._log(result, order_number)
            except Exception:  # noqa: BLE001 - logging must never break a purchase
                logger.exception("Could not write 1Epin API log")
        return result

    def check_balance(self) -> OneEpinResult:
        return self.call("checkBalance")

    def categories(self) -> OneEpinResult:
        return self.call("categories")

    def products(self, category: int) -> OneEpinResult:
        return self.call("products", {"category": int(category)})

    def all_products(self) -> OneEpinResult:
        return self.call("allProducts")

    def category_detail(self, category: int) -> OneEpinResult:
        return self.call("categoryDetail", {"category": int(category)})

    def add_order(
        self, *, product: int | str, order_number: str, quantity: int | None = None, user: str | None = None, barem=None
    ) -> OneEpinResult:
        params: dict[str, Any] = {"product": int(product), "orderNumber": order_number}
        if quantity is not None:
            params["quantity"] = int(quantity)
        if user:
            params["user"] = str(user)
        if barem is not None:
            params["barem"] = float(barem)
        return self.call("addOrder", params, order_number=order_number)

    def check_order(self, order_number: str) -> OneEpinResult:
        return self.call("checkOrder", {"orderNumber": order_number}, order_number=order_number)


# --- Providers -----------------------------------------------------------------------------


def credentials_configured() -> bool:
    return bool(settings.ONEEPIN_EMAIL and settings.ONEEPIN_PASSWORD)


def ensure_supplier() -> Supplier:
    """The 1Epin Supplier row plus its connection, kept in sync with the environment."""
    from suppliers.services.config import current_environment

    supplier, _ = Supplier.objects.get_or_create(slug=SUPPLIER_SLUG, defaults={"name": "1Epin"})
    env = current_environment()
    base_url = settings.ONEEPIN_LIVE_BASE_URL if env == SupplierEnvironment.LIVE else settings.ONEEPIN_TEST_BASE_URL
    connection, _ = SupplierConnection.objects.get_or_create(supplier=supplier, defaults={"environment": env})
    wanted = {
        "environment": env,
        "base_url": "" if env == SupplierEnvironment.MOCK else base_url,
        "email_configured": bool(settings.ONEEPIN_EMAIL),
        "password_configured": bool(settings.ONEEPIN_PASSWORD),
        "callback_configured": bool(settings.ONEEPIN_CALLBACK_TOKEN),
    }
    changed = [k for k, v in wanted.items() if getattr(connection, k) != v]
    if changed:
        for k in changed:
            setattr(connection, k, wanted[k])
        connection.save(update_fields=changed + ["updated_at"])
    supplier.connection = connection
    return supplier


# Back-compat name used by seeds and views.
ensure_mock_supplier = ensure_supplier


def log_supplier_action(
    supplier: Supplier,
    action: str,
    ok: bool,
    message: str = "",
    status_code: int | None = None,
    *,
    result_code: str = "",
    order_number: str = "",
    duration_ms: int | None = None,
    environment: str = "",
):
    SupplierApiLog.objects.create(
        supplier=supplier,
        action=action[:64],
        ok=ok,
        status_code=status_code,
        message=(message or "")[:1000],
        result_code=(result_code or "")[:8],
        order_number=(order_number or "")[:120],
        duration_ms=duration_ms,
        environment=environment,
    )


class OneEpinProvider:
    environment = SupplierEnvironment.TEST

    def __init__(self, environment: str | None = None, transport=None):
        if environment:
            self.environment = environment
        if self.environment == SupplierEnvironment.LIVE and not live_enabled():
            raise SupplierError(LIVE_DISABLED_MESSAGE)
        base = settings.ONEEPIN_LIVE_BASE_URL if self.environment == SupplierEnvironment.LIVE else settings.ONEEPIN_TEST_BASE_URL
        self.mode = self.environment.lower()
        self.client = OneEpinClient(
            base_url=base,
            email=settings.ONEEPIN_EMAIL,
            password=settings.ONEEPIN_PASSWORD,
            transport=transport or default_transport(self.environment),
            timeout=max(int(settings.ONEEPIN_REQUEST_TIMEOUT_MS), 500) / 1000,
            environment=self.environment,
            log=self._write_log,
        )

    def _write_log(self, result: OneEpinResult, order_number: str) -> None:
        supplier = Supplier.objects.filter(slug=SUPPLIER_SLUG).first() or ensure_supplier()
        log_supplier_action(
            supplier,
            result.method,
            result.ok,
            result.log_message,
            result.http_status,
            result_code=result.code,
            order_number=order_number,
            duration_ms=result.duration_ms,
            environment=self.environment,
        )
        if not result.ok:
            logger.warning(
                "1Epin %s failed (env=%s code=%s order=%s): %s",
                result.method,
                self.environment,
                result.code or "-",
                order_number or "-",
                result.readable,
            )

    @property
    def can_authenticate(self) -> bool:
        return self.environment == SupplierEnvironment.MOCK or credentials_configured()

    def check_connection(self) -> dict:
        if not self.can_authenticate:
            return {"ok": False, "mode": self.mode, "message": "1Epin credentials not configured"}
        bal = self.get_balance()
        return {"ok": bal.ok, "mode": self.mode, "message": bal.message, "code": bal.code}

    def get_balance(self) -> BalanceResult:
        res = self.client.check_balance()
        amount = to_decimal(res.data.get("Balance")) if res.ok else None
        return BalanceResult(
            amount=f"{amount:.2f}" if amount is not None else "",
            currency=settings.ONEEPIN_CURRENCY,
            message=res.message if res.ok else res.readable,
            ok=res.ok and amount is not None,
            code=res.code,
        )

    def sync_catalog(self) -> dict:
        from suppliers.services.catalog import sync_catalog

        return sync_catalog(provider=self)


class MockSupplierProvider(OneEpinProvider):
    environment = SupplierEnvironment.MOCK

    def __init__(self, transport=None):
        super().__init__(SupplierEnvironment.MOCK, transport=transport or default_transport(SupplierEnvironment.MOCK))

    def check_connection(self) -> dict:
        bal = self.get_balance()
        return {
            "ok": bal.ok,
            "mode": "mock",
            "message": MOCK_CONNECTION_MESSAGE if bal.ok else bal.message,
            "code": bal.code,
        }


def live_enabled() -> bool:
    return (settings.SUPPLIER_MODE or "").lower() == "live" and bool(settings.ONEEPIN_ALLOW_LIVE)


def assert_live_locked() -> None:
    """Raise when live mode is requested without the ONEEPIN_ALLOW_LIVE switch."""
    if (settings.SUPPLIER_MODE or "").lower() == "live" and not settings.ONEEPIN_ALLOW_LIVE:
        raise SupplierError(LIVE_DISABLED_MESSAGE)


def get_supplier_provider(transport=None) -> OneEpinProvider:
    mode = (settings.SUPPLIER_MODE or "mock").lower()
    if mode == "mock":
        return MockSupplierProvider(transport=transport)
    if mode == "test":
        return OneEpinProvider(SupplierEnvironment.TEST, transport=transport)
    if mode == "live":
        assert_live_locked()
        return OneEpinProvider(SupplierEnvironment.LIVE, transport=transport)
    raise SupplierError(f"Unknown SUPPLIER_MODE {mode!r} (use mock, test or live)")
