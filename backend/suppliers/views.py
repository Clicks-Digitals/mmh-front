from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Exists, OuterRef, Q
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, serializers, status, viewsets
from rest_framework.exceptions import APIException
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from accounts.permissions import has_permission
from audit.services import AuditedModelViewSetMixin, record_audit
from catalog.models import FulfillmentType, ProductVariant
from catalog.serializers import AutoSlugMixin, _check_unique_slug
from catalog.stock import mapping_stock_payload, supplier_is_live
from commerce.models import OrderItem
from suppliers.models import (
    IN_FLIGHT_STATUSES,
    AlertKind,
    Supplier,
    SupplierAlert,
    SupplierApiLog,
    SupplierCatalogItem,
    SupplierConnection,
    SupplierOrder,
    SupplierProductMapping,
    SupplierStatus,
    SupplierWebhookEvent,
)
from suppliers.provider import (
    SupplierError,
    UrllibTransport,
    ensure_supplier,
    get_supplier_provider,
    log_supplier_action,
    sanitize_payload,
    to_decimal,
)
from suppliers.services.alerts import is_low, record_balance, resolve_alert
from suppliers.services.config import (
    callback_url,
    current_environment,
    fx_to_jod,
    live_enabled,
    low_balance_threshold,
    mapping_stock_mode_ok,
    supplier_mode,
    trading_disabled_reason,
    trading_enabled,
)
from suppliers.services.config import currency as oneepin_currency
from suppliers.services.fulfillment import (
    SupplierActionError,
    needs_review_order_count,
    needs_review_supplier_orders,
    staff_check,
    staff_purchase,
    sync_supplier_order,
)
from suppliers.services.mapping import catalog_item_brief, mapping_payload
from suppliers.services.payloads import latest_attempts, supplier_order_payload
from suppliers.services.reconcile import reconcile_supplier_orders

logger = logging.getLogger("suppliers")

# Back-compat alias (older code/tests import it from here).
ensure_mock_supplier = ensure_supplier


class SupplierSerializer(serializers.ModelSerializer):
    environment = serializers.CharField(source="connection.environment", read_only=True)
    email_configured = serializers.BooleanField(source="connection.email_configured", read_only=True)
    password_configured = serializers.BooleanField(source="connection.password_configured", read_only=True)
    callback_configured = serializers.BooleanField(source="connection.callback_configured", read_only=True)
    last_balance = serializers.CharField(source="connection.last_balance", read_only=True)
    last_checked_at = serializers.DateTimeField(source="connection.last_checked_at", read_only=True)
    live_purchasing = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = (
            "id",
            "slug",
            "name",
            "active",
            "live_purchasing",
            "created_at",
            "environment",
            "email_configured",
            "password_configured",
            "callback_configured",
            "last_balance",
            "last_checked_at",
        )
        read_only_fields = ("created_at",)

    def get_live_purchasing(self, obj) -> bool:
        """D18: True only when live purchasing is enabled for this supplier."""
        return bool(obj.active and supplier_is_live(obj))


class SupplierWriteSerializer(AutoSlugMixin, serializers.ModelSerializer):
    """Blank/missing ``slug`` on create is derived from ``name`` (CA-15)."""

    slug_source = "name"
    slug_fallback = "supplier"
    slug = serializers.SlugField(max_length=50, required=False, allow_blank=True)

    class Meta:
        model = Supplier
        fields = ("id", "slug", "name", "active")
        read_only_fields = ("id",)

    def validate_slug(self, value):
        return _check_unique_slug(self, value)


class SupplierMappingSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name_en", read_only=True, allow_null=True)
    variant_name = serializers.CharField(source="variant.name_en", read_only=True, allow_null=True, default=None)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True, allow_null=True, default=None)
    counts_as_stock = serializers.SerializerMethodField()
    counts_as_stock_reason = serializers.SerializerMethodField()
    counts_as_stock_message = serializers.SerializerMethodField()

    class Meta:
        model = SupplierProductMapping
        fields = (
            "id",
            "product",
            "product_name",
            "variant",
            "variant_name",
            "variant_sku",
            "external_product_id",
            "external_name",
            "ignored",
            "created_at",
            "counts_as_stock",
            "counts_as_stock_reason",
            "counts_as_stock_message",
        )

    def _payload(self, obj) -> dict:
        cache = getattr(obj, "_stock_payload", None)
        if cache is None:
            cache = obj._stock_payload = mapping_stock_payload(obj)
        return cache

    def get_counts_as_stock(self, obj) -> bool:
        return self._payload(obj)["counts_as_stock"]

    def get_counts_as_stock_reason(self, obj):
        return self._payload(obj)["counts_as_stock_reason"]

    def get_counts_as_stock_message(self, obj) -> str:
        return self._payload(obj)["counts_as_stock_message"]


class SupplierOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierOrder
        fields = ("id", "order_item_id", "supplier_ref", "status", "created_at", "updated_at")


class SupplierLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierApiLog
        fields = ("id", "action", "ok", "status_code", "message", "created_at")


class SupplierInUse(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This supplier is used by product mappings or orders. Deactivate it instead."
    default_code = "conflict"


class AdminSupplierViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "supplier"

    def perform_destroy(self, instance):
        try:
            super().perform_destroy(instance)
        except ProtectedError as exc:
            raise SupplierInUse() from exc
    permission_classes = [IsAdminUser, HasAdminPermission]
    queryset = Supplier.objects.select_related("connection").order_by("name", "id")
    search_fields = ["slug", "name"]
    filterset_fields = ["active"]

    def get_permissions(self):
        if self.action == "list":
            # RO-11: the product editor (catalog roles) needs the supplier lookup list.
            self.admin_permission = ("suppliers.read", "catalog.read")
        elif self.action == "retrieve":
            self.admin_permission = "suppliers.read"
        else:
            self.admin_permission = "suppliers.write"
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return SupplierWriteSerializer
        return SupplierSerializer

    def retrieve(self, request, *args, **kwargs):
        supplier = self.get_object()
        data = SupplierSerializer(supplier).data
        data["mappings"] = SupplierMappingSerializer(
            supplier.mappings.select_related("product", "variant", "supplier", "supplier__connection")[:50], many=True
        ).data
        data["recent_orders"] = SupplierOrderSerializer(supplier.orders.order_by("-created_at")[:20], many=True).data
        data["recent_logs"] = SupplierLogSerializer(supplier.api_logs.order_by("-created_at")[:20], many=True).data
        data["live_locked"] = not supplier_is_live(supplier)
        return Response(data)

    def perform_create(self, serializer):
        super().perform_create(serializer)
        SupplierConnection.objects.get_or_create(supplier=serializer.instance)

    def _audit_label(self, instance) -> dict:
        return {"slug": instance.slug, "name": instance.name, "active": instance.active}


CREDENTIALS_MISSING_MESSAGE = (
    "1Epin credentials are not configured (set ONEEPIN_EMAIL and ONEEPIN_PASSWORD on the server). "
    "The connection was not tested."
)
BALANCE_TEST_MODE_MESSAGE = "Balance is not available in test mode"
ONEEPIN_SETTINGS_URL = "https://www.1epin.com/api-ayarlari"
OUTGOING_IP_CACHE_KEY = "oneepin:outgoing_ip"
OUTGOING_IP_TTL = 6 * 3600


def credentials_configured() -> bool:
    return bool(settings.ONEEPIN_EMAIL and settings.ONEEPIN_PASSWORD)


def _ip_transport():
    from suppliers import provider as provider_module

    return provider_module._transport_override or UrllibTransport(proxy=settings.ONEEPIN_HTTP_PROXY)


def outgoing_ip(supplier: Supplier, *, refresh: bool = False) -> dict:
    """Public IP 1Epin sees (through ONEEPIN_HTTP_PROXY when set). Cached; looked up on demand."""
    cached = cache.get(OUTGOING_IP_CACHE_KEY)
    if cached and not refresh:
        return cached
    meta = supplier.connection.meta or {}
    stored = {"ip": meta.get("outgoing_ip", ""), "checked_at": meta.get("outgoing_ip_checked_at"), "error": ""}
    auto_lookup = bool(settings.ONEEPIN_IP_LOOKUP_URL) and not getattr(settings, "TESTING", False)
    if not refresh and (stored["ip"] or not auto_lookup):
        return stored
    if not settings.ONEEPIN_IP_LOOKUP_URL:
        return {**stored, "error": "ONEEPIN_IP_LOOKUP_URL is not set"}
    try:
        data = _ip_transport().get_json(settings.ONEEPIN_IP_LOOKUP_URL, 5)
        ip = str(data.get("ip") or "").strip()[:64]
    except Exception as exc:  # noqa: BLE001
        return {**stored, "error": f"Could not look up the outgoing IP: {exc}"[:200]}
    result = {"ip": ip, "checked_at": timezone.now().isoformat(), "error": "" if ip else "Lookup returned no IP"}
    if ip:
        connection = supplier.connection
        meta = dict(connection.meta or {})
        meta["outgoing_ip"] = ip
        meta["outgoing_ip_checked_at"] = result["checked_at"]
        connection.meta = meta
        connection.save(update_fields=["meta", "updated_at"])
        cache.set(OUTGOING_IP_CACHE_KEY, result, OUTGOING_IP_TTL)
    return result


def _masked_callback_url() -> str:
    url = callback_url(with_token=False)
    return f"{url}********/" if settings.ONEEPIN_CALLBACK_TOKEN else url


def supplier_status_payload(supplier: Supplier, *, request=None, refresh_ip: bool = False) -> dict:
    """Shape shared by status, ping and balance responses."""
    connection = supplier.connection
    meta = connection.meta or {}
    env = current_environment()
    balance = to_decimal(connection.last_balance)
    can_see_secret = bool(request is not None and has_permission(request.user, "suppliers.write"))
    ip = outgoing_ip(supplier, refresh=refresh_ip)
    return {
        "supplier": supplier.slug,
        "mode": supplier_mode(),
        "environment": connection.environment,
        "base_url": connection.base_url,
        "email_configured": connection.email_configured,
        "password_configured": connection.password_configured,
        "callback_configured": connection.callback_configured,
        "credentials_configured": credentials_configured(),
        "last_balance": connection.last_balance,
        "last_balance_currency": meta.get("balance_currency", ""),
        "last_checked_at": connection.last_checked_at,
        "balance": {
            "amount": connection.last_balance or None,
            "currency": meta.get("balance_currency") or oneepin_currency(),
            "checked_at": connection.last_checked_at,
        },
        "low_balance": is_low(balance),
        "low_balance_threshold": f"{low_balance_threshold()}",
        "live_enabled": live_enabled(),
        "live_purchasing": bool(supplier.active and supplier_is_live(supplier)),
        "live_locked": not supplier_is_live(supplier),
        "trading_enabled": trading_enabled(),
        "trading_disabled_reason": trading_disabled_reason(),
        "mappings_count_as_stock": mapping_stock_mode_ok(),
        "callback_url": callback_url() if can_see_secret else _masked_callback_url(),
        "callback_token_configured": bool(settings.ONEEPIN_CALLBACK_TOKEN),
        "api_settings_url": ONEEPIN_SETTINGS_URL,
        "proxy_configured": bool(settings.ONEEPIN_HTTP_PROXY),
        "outgoing_ip": ip.get("ip") or None,
        "outgoing_ip_checked_at": ip.get("checked_at"),
        "outgoing_ip_error": ip.get("error") or "",
        "last_catalog_sync": connection.last_catalog_sync_at,
        "last_catalog_sync_result": connection.last_catalog_sync_result or {},
        "catalog_items": SupplierCatalogItem.objects.filter(supplier=supplier, environment=env, active=True).count(),
        "mappings": SupplierProductMapping.objects.filter(supplier=supplier, ignored=False).count(),
        "open_alerts": SupplierAlert.objects.filter(supplier=supplier, resolved=False).count(),
        "orders_in_flight": SupplierOrder.objects.filter(supplier=supplier, status__in=IN_FLIGHT_STATUSES).count(),
        # Distinct ORDERS waiting for a person (same rule as the orders page ``needs_review`` filter).
        "orders_manual_review": needs_review_order_count(),
        "fx_to_jod": f"{fx_to_jod()}",
        "currency": oneepin_currency(),
    }


def _balance_payload(supplier: Supplier, *, ok: bool, message: str, cached: bool) -> dict:
    connection = supplier.connection
    currency_code = (connection.meta or {}).get("balance_currency", "")
    balance = to_decimal(connection.last_balance)
    return {
        "ok": ok,
        "cached": cached,
        "balance": connection.last_balance or None,
        # ``amount`` kept for older panel builds.
        "amount": connection.last_balance or None,
        "currency": currency_code,
        "last_checked_at": connection.last_checked_at,
        "low_balance": is_low(balance),
        "message": message,
    }


class SupplierStatusView(APIView):
    """GET admin/1epin/status/[?refresh_ip=1]"""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        supplier = ensure_supplier()
        refresh = str(request.query_params.get("refresh_ip", "")).lower() in {"1", "true", "yes"}
        return Response(supplier_status_payload(supplier, request=request, refresh_ip=refresh))


class SupplierPingView(APIView):
    """Runs a connection check; returns the status object plus ``ok`` and ``message``."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_supplier()
        if supplier_mode() != "mock" and not credentials_configured():
            # CA-25: never report a successful test without credentials (mock = the local simulator).
            message = CREDENTIALS_MISSING_MESSAGE
            log_supplier_action(supplier, "ping", False, message)
            payload = supplier_status_payload(supplier, request=request)
            payload.update({"ok": False, "message": message, "detail": message, "code": "not_configured"})
            return Response(payload, status=status.HTTP_409_CONFLICT)
        try:
            provider = get_supplier_provider()
            result = provider.check_connection()
        except SupplierError as exc:
            log_supplier_action(supplier, "ping", False, str(exc))
            payload = supplier_status_payload(supplier, request=request)
            payload.update({"ok": False, "message": str(exc), "detail": str(exc)})
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        ok = bool(result.get("ok"))
        message = str(result.get("message", ""))
        log_supplier_action(supplier, "ping", ok, message)
        connection = supplier.connection
        connection.last_checked_at = timezone.now()
        connection.save(update_fields=["last_checked_at", "updated_at"])
        record_audit(request.user, "suppliers.1epin.ping", entity_type="Supplier", entity_id=supplier.pk, meta={"ok": ok})
        payload = supplier_status_payload(supplier, request=request)
        payload.update({"ok": ok, "message": message, "code": result.get("code", "")})
        return Response(payload)


class SupplierBalanceView(APIView):
    """Read-only: last cached balance. Use POST balance/refresh/ to query the supplier."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        supplier = ensure_supplier()
        has_value = bool(supplier.connection.last_balance)
        message = "Last cached balance" if has_value else "Balance has not been fetched yet"
        return Response(_balance_payload(supplier, ok=has_value, message=message, cached=True))


class SupplierBalanceRefreshView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_supplier()
        try:
            provider = get_supplier_provider()
        except SupplierError as exc:
            log_supplier_action(supplier, "balance", False, str(exc))
            payload = _balance_payload(supplier, ok=False, message=str(exc), cached=True)
            payload.update({"detail": str(exc), "code": "supplier_error"})
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        if not getattr(provider, "can_authenticate", True):
            payload = _balance_payload(supplier, ok=False, message=CREDENTIALS_MISSING_MESSAGE, cached=True)
            payload.update({"detail": CREDENTIALS_MISSING_MESSAGE, "code": "not_configured"})
            return Response(payload, status=status.HTTP_409_CONFLICT)
        try:
            bal = provider.get_balance()
        except SupplierError as exc:
            log_supplier_action(supplier, "balance", False, str(exc))
            payload = _balance_payload(supplier, ok=False, message=str(exc), cached=True)
            payload["detail"] = str(exc)
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        record_audit(
            request.user, "suppliers.1epin.balance_refresh", entity_type="Supplier", entity_id=supplier.pk,
            meta={"ok": bal.ok, "code": getattr(bal, "code", "")},
        )
        if not bal.ok:
            connection = supplier.connection
            connection.last_checked_at = timezone.now()
            connection.save(update_fields=["last_checked_at", "updated_at"])
            payload = _balance_payload(supplier, ok=False, message=bal.message, cached=True)
            payload["detail"] = bal.message or "Supplier rejected the balance request"
            payload["code"] = getattr(bal, "code", "") or "supplier_error"
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        record_balance(supplier, to_decimal(bal.amount))
        supplier.connection.refresh_from_db()
        payload = _balance_payload(supplier, ok=True, message=bal.message, cached=False)
        payload["currency"] = bal.currency or payload["currency"]
        return Response(payload)


class SupplierSyncView(APIView):
    """POST admin/1epin/catalog/sync/ (alias: admin/1epin/sync/). 2xx only when the sync ran.

    * 200 ``{ok: true, created, updated, deactivated, total, price_alerts, environment, synced_at, message}``
    * 409 ``{ok: false, detail, code}`` when it cannot run (credentials missing / live disabled)
    * 502 ``{ok: false, detail, code}`` when 1Epin failed (e.g. code 02 = IP not registered)
    """

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_supplier()
        try:
            provider = get_supplier_provider()
            result = provider.sync_catalog()
        except SupplierError as exc:
            log_supplier_action(supplier, "sync", False, str(exc))
            return Response({"ok": False, "detail": str(exc), "message": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        ok = bool(result.get("ok"))
        message = str(result.get("message", ""))
        record_audit(
            request.user,
            "suppliers.1epin.catalog_sync",
            entity_type="Supplier",
            entity_id=supplier.pk,
            meta={k: result.get(k) for k in ("ok", "created", "updated", "deactivated", "total", "code") if k in result},
        )
        body = {**result, "ok": ok, "message": message}
        if ok:
            return Response(body)
        body["detail"] = message or "Sync did not run"
        code = status.HTTP_409_CONFLICT if result.get("noop") or result.get("code") in {"not_configured", "disabled"} else status.HTTP_502_BAD_GATEWAY
        return Response(body, status=code)


# --- Remote catalog ---------------------------------------------------------------------------


def _truthy(value) -> bool | None:
    if value is None or str(value).strip() == "":
        return None
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class SupplierCatalogListView(generics.ListAPIView):
    """GET admin/1epin/catalog/?search=&category=&type=&mapped=true|false&active=true|false|all&page=&page_size="""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = ("suppliers.read", "suppliers.write")
    filter_backends: list = []

    def get_queryset(self):
        supplier = ensure_supplier()
        params = self.request.query_params
        qs = SupplierCatalogItem.objects.filter(supplier=supplier, environment=current_environment())
        active = (params.get("active") or "true").lower()
        if active != "all":
            qs = qs.filter(active=active in {"1", "true", "yes"})
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(product_name__icontains=search)
                | Q(category_name__icontains=search)
                | Q(external_product_id=search)
            )
        category = (params.get("category") or "").strip()
        if category:
            qs = qs.filter(Q(external_category_id=category) | Q(category_name__iexact=category))
        kind = (params.get("type") or "").strip().lower()
        if kind:
            qs = qs.filter(category_type=kind)
        mapped_rows = SupplierProductMapping.objects.filter(
            supplier=supplier, external_product_id=OuterRef("external_product_id")
        )
        qs = qs.annotate(_mapped=Exists(mapped_rows))
        mapped = _truthy(params.get("mapped"))
        if mapped is not None:
            qs = qs.filter(_mapped=mapped)
        return qs.order_by("category_name", "product_name", "id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        ids = [item.external_product_id for item in page]
        by_pid: dict[str, list] = {}
        for m in SupplierProductMapping.objects.select_related("product", "variant").filter(
            supplier__slug="1epin", external_product_id__in=ids
        ):
            by_pid.setdefault(m.external_product_id, []).append(
                {
                    "id": m.id,
                    "product": m.product_id,
                    "product_name": m.product.name_en,
                    "variant": m.variant_id,
                    "variant_name": m.variant.name_en if m.variant_id else None,
                    "variant_sku": m.variant.sku if m.variant_id else None,
                    "auto_buy": m.auto_buy,
                    "ignored": m.ignored,
                }
            )
        rows = []
        for item in page:
            row = catalog_item_brief(item)
            row["mapped"] = bool(getattr(item, "_mapped", False))
            row["mappings"] = by_pid.get(item.external_product_id, [])
            rows.append(row)
        return self.get_paginated_response(rows)


class SupplierCatalogCategoriesView(APIView):
    """GET admin/1epin/catalog/categories/ -> [{id, name, type, products}] (filter dropdown)."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = ("suppliers.read", "suppliers.write")

    def get(self, request):
        supplier = ensure_supplier()
        rows = (
            SupplierCatalogItem.objects.filter(supplier=supplier, environment=current_environment(), active=True)
            .values("external_category_id", "category_name", "category_type")
            .annotate(products=Count("id"))
            .order_by("category_name")
        )
        return Response(
            [
                {"id": r["external_category_id"], "name": r["category_name"], "type": r["category_type"], "products": r["products"]}
                for r in rows
            ]
        )


# --- Mappings ----------------------------------------------------------------------------------


class MappingWriteSerializer(serializers.Serializer):
    variant_id = serializers.IntegerField(required=False)
    catalog_item_id = serializers.IntegerField(required=False, allow_null=True)
    external_product_id = serializers.CharField(required=False, allow_blank=False, max_length=64)
    quantity_per_unit = serializers.IntegerField(required=False, min_value=1, max_value=1000)
    prefer_supplier = serializers.BooleanField(required=False)
    auto_buy = serializers.BooleanField(required=False)
    allow_loss = serializers.BooleanField(required=False)
    ignored = serializers.BooleanField(required=False)
    max_cost_fils = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    user_template = serializers.CharField(required=False, allow_blank=True, max_length=255)
    barem = serializers.DecimalField(required=False, allow_null=True, max_digits=14, decimal_places=4)


MAPPING_FIELDS = ("quantity_per_unit", "prefer_supplier", "auto_buy", "allow_loss", "ignored", "max_cost_fils", "user_template", "barem")


class MappingError(Exception):
    def __init__(self, detail: str, code: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status_code = status_code


def _resolve_catalog_item(supplier: Supplier, data: dict) -> SupplierCatalogItem:
    item = None
    if data.get("catalog_item_id"):
        item = SupplierCatalogItem.objects.filter(supplier=supplier, pk=data["catalog_item_id"]).first()
    elif data.get("external_product_id"):
        item = SupplierCatalogItem.objects.filter(
            supplier=supplier, environment=current_environment(), external_product_id=str(data["external_product_id"]).strip()
        ).first()
    if item is None:
        raise MappingError("1Epin product not found in the synced catalog (sync the catalog first)", "catalog_item_not_found", 404)
    return item


def _check_type(item: SupplierCatalogItem, variant: ProductVariant) -> None:
    ftype = variant.product.fulfillment_type
    if item.category_type == "topup" and ftype != FulfillmentType.DIRECT_TOPUP:
        raise MappingError("This 1Epin product is a top-up; map it to a direct top-up product", "type_mismatch")
    if item.category_type == "epin" and ftype != FulfillmentType.CODE:
        raise MappingError("This 1Epin product is an e-pin (code); map it to a code product", "type_mismatch")


def _mapping_audit(request, action: str, mapping: SupplierProductMapping, **extra) -> None:
    record_audit(
        request.user,
        action,
        entity_type="SupplierProductMapping",
        entity_id=mapping.pk,
        meta={
            "product_id": mapping.product_id,
            "variant_id": mapping.variant_id,
            "supplier_id": mapping.supplier_id,
            "external_product_id": mapping.external_product_id,
            **extra,
        },
    )


def _mapping_qs():
    return SupplierProductMapping.objects.select_related(
        "supplier", "supplier__connection", "product", "variant", "catalog_item"
    )


class SupplierMappingListView(generics.ListAPIView):
    """GET admin/1epin/mappings/?search=&product=&variant=&external_product_id=&auto_buy=
    POST admin/1epin/mappings/ {variant_id, catalog_item_id | external_product_id, ...options}"""

    permission_classes = [IsAdminUser, HasAdminPermission]
    filter_backends: list = []

    def get_permissions(self):
        self.admin_permission = ("suppliers.read", "suppliers.write") if self.request.method == "GET" else "suppliers.write"
        return super().get_permissions()

    def get_queryset(self):
        params = self.request.query_params
        qs = _mapping_qs().filter(supplier__slug="1epin")
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(product__name_en__icontains=search)
                | Q(variant__name_en__icontains=search)
                | Q(variant__sku__icontains=search)
                | Q(external_name__icontains=search)
                | Q(catalog_item__product_name__icontains=search)
                | Q(external_product_id=search)
            )
        for key in ("product", "variant"):
            if str(params.get(key, "")).isdigit():
                qs = qs.filter(**{f"{key}_id": int(params[key])})
        if params.get("external_product_id"):
            qs = qs.filter(external_product_id=str(params["external_product_id"]))
        auto_buy = _truthy(params.get("auto_buy"))
        if auto_buy is not None:
            qs = qs.filter(auto_buy=auto_buy)
        return qs.order_by("product__name_en", "variant__sort_order", "id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([mapping_payload(m) for m in page])

    def post(self, request):
        serializer = MappingWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        supplier = ensure_supplier()
        try:
            if not data.get("variant_id"):
                raise MappingError("variant_id is required", "variant_required")
            variant = ProductVariant.objects.select_related("product").filter(pk=data["variant_id"]).first()
            if variant is None:
                raise MappingError("Product option not found", "variant_not_found", 404)
            item = _resolve_catalog_item(supplier, data)
            _check_type(item, variant)
            if SupplierProductMapping.objects.filter(supplier=supplier, variant=variant).exists():
                raise MappingError("This product option is already mapped to 1Epin; edit that mapping instead", "variant_already_mapped", 409)
        except MappingError as exc:
            return Response({"detail": exc.detail, "code": exc.code}, status=exc.status_code)
        mapping = SupplierProductMapping(
            supplier=supplier,
            product=variant.product,
            variant=variant,
            external_product_id=item.external_product_id,
            external_name=item.product_name[:255],
            catalog_item=item,
            category_type=item.category_type,
        )
        for field in MAPPING_FIELDS:
            if field in data:
                setattr(mapping, field, data[field])
        mapping.save()
        _mapping_audit(request, "supplier.mapping.created", mapping, fields=sorted(data.keys()))
        return Response(mapping_payload(_mapping_qs().get(pk=mapping.pk)), status=status.HTTP_201_CREATED)


class SupplierMappingDetailView(APIView):
    """GET / PATCH / DELETE admin/1epin/mappings/<id>/"""

    permission_classes = [IsAdminUser, HasAdminPermission]

    def get_permissions(self):
        self.admin_permission = ("suppliers.read", "suppliers.write") if self.request.method == "GET" else "suppliers.write"
        return super().get_permissions()

    def _get(self, mapping_id):
        return _mapping_qs().filter(pk=mapping_id).first()

    def get(self, request, mapping_id: int):
        mapping = self._get(mapping_id)
        if mapping is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        return Response(mapping_payload(mapping))

    def patch(self, request, mapping_id: int):
        mapping = self._get(mapping_id)
        if mapping is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        serializer = MappingWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            variant = mapping.variant
            if data.get("variant_id"):
                variant = ProductVariant.objects.select_related("product").filter(pk=data["variant_id"]).first()
                if variant is None:
                    raise MappingError("Product option not found", "variant_not_found", 404)
                if SupplierProductMapping.objects.filter(supplier=mapping.supplier, variant=variant).exclude(pk=mapping.pk).exists():
                    raise MappingError("This product option is already mapped to 1Epin", "variant_already_mapped", 409)
            item = None
            if data.get("catalog_item_id") or data.get("external_product_id"):
                item = _resolve_catalog_item(mapping.supplier, data)
            if variant is not None and (item or mapping.catalog_item):
                _check_type(item or mapping.catalog_item, variant)
        except MappingError as exc:
            return Response({"detail": exc.detail, "code": exc.code}, status=exc.status_code)
        if variant is not None and variant.pk != mapping.variant_id:
            mapping.variant = variant
            mapping.product = variant.product
        if item is not None:
            mapping.catalog_item = item
            mapping.external_product_id = item.external_product_id
            mapping.external_name = item.product_name[:255]
            mapping.category_type = item.category_type
        for field in MAPPING_FIELDS:
            if field in data:
                setattr(mapping, field, data[field])
        mapping.save()
        _mapping_audit(request, "supplier.mapping.updated", mapping, fields=sorted(data.keys()))
        return Response(mapping_payload(self._get(mapping.pk)))

    def delete(self, request, mapping_id: int):
        mapping = self._get(mapping_id)
        if mapping is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        _mapping_audit(request, "supplier.mapping.deleted", mapping)
        mapping.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Supplier orders ------------------------------------------------------------------------------


def _parse_date(value):
    from django.utils.dateparse import parse_date, parse_datetime

    if not value:
        return None
    dt = parse_datetime(value)
    if dt is None:
        d = parse_date(value)
        if d is None:
            return None
        from datetime import datetime, time

        dt = datetime.combine(d, time.min)
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


def _supplier_order_qs():
    return SupplierOrder.objects.select_related("order", "created_by", "supplier")


class SupplierOrderListView(generics.ListAPIView):
    """GET admin/1epin/orders/?status=&created_from=&created_to=&search=&order=&environment="""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = ("suppliers.read", "orders.read")
    filter_backends: list = []

    def get_queryset(self):
        params = self.request.query_params
        qs = _supplier_order_qs()
        if _truthy(params.get("needs_review")):
            # Same rule as the dashboard / overview "need review" count.
            qs = qs.filter(pk__in=needs_review_supplier_orders().values("pk"))
        statuses = [s.strip().upper() for s in (params.get("status") or "").split(",") if s.strip()]
        if statuses:
            qs = qs.filter(status__in=statuses)
        if params.get("environment"):
            qs = qs.filter(environment=params["environment"].upper())
        start = _parse_date(params.get("created_from"))
        end = _parse_date(params.get("created_to"))
        if start:
            qs = qs.filter(created_at__gte=start)
        if end:
            if len(params.get("created_to", "")) <= 10:
                end = end + timedelta(days=1)
            qs = qs.filter(created_at__lt=end)
        order_ref = str(params.get("order") or "").strip()
        if order_ref:
            cond = Q(order__order_number=order_ref)
            if order_ref.isdigit() and len(order_ref) <= 9:
                cond |= Q(order_id=int(order_ref))
            qs = qs.filter(cond)
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(supplier_ref__icontains=search)
                | Q(order__order_number__icontains=search)
                | Q(product_name__icontains=search)
                | Q(external_product_id=search)
            )
        return qs.order_by("-created_at", "-id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        items = {
            i.id: i
            for i in OrderItem.objects.filter(id__in=[so.order_item_id for so in page])
        }
        latest = latest_attempts([so.order_item_id for so in page])
        rows = []
        for so in page:
            row = supplier_order_payload(so, latest_attempts=latest)
            item = items.get(so.order_item_id)
            row["item"] = (
                {"id": item.id, "product_name": item.product_name, "variant_name": item.variant_name, "quantity": item.quantity}
                if item
                else None
            )
            rows.append(row)
        return self.get_paginated_response(rows)


class SupplierOrderDetailView(APIView):
    """GET admin/1epin/orders/<id>/ -> supplier order + item + callbacks + API log lines."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = ("suppliers.read", "orders.read")

    def get(self, request, so_id: int):
        so = _supplier_order_qs().filter(pk=so_id).first()
        if so is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        data = supplier_order_payload(so)
        item = OrderItem.objects.filter(pk=so.order_item_id).first()
        data["item"] = (
            {"id": item.id, "product_name": item.product_name, "variant_name": item.variant_name, "quantity": item.quantity}
            if item
            else None
        )
        data["request"] = so.request_payload
        data["response"] = so.response_payload
        data["attempts"] = [
            {"id": o.id, "attempt": o.attempt, "external_order_number": o.supplier_ref, "status": o.status, "message": o.message, "created_at": o.created_at}
            for o in SupplierOrder.objects.filter(order_item_id=so.order_item_id).order_by("attempt")
        ]
        data["callbacks"] = [
            {"id": e.id, "processed": e.processed, "reason": e.reason, "payload": e.payload, "created_at": e.created_at}
            for e in SupplierWebhookEvent.objects.filter(supplier_ref=so.supplier_ref).order_by("-created_at")[:20]
        ]
        data["api_logs"] = [
            {"id": log.id, "action": log.action, "ok": log.ok, "result_code": log.result_code, "message": log.message, "duration_ms": log.duration_ms, "created_at": log.created_at}
            for log in SupplierApiLog.objects.filter(order_number=so.supplier_ref).order_by("-created_at")[:50]
        ]
        return Response(data)


class SupplierOrderCheckView(APIView):
    """POST admin/1epin/orders/<id>/check/ -> checkOrder now and apply."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.fulfill"

    def post(self, request, so_id: int):
        so = _supplier_order_qs().filter(pk=so_id).first()
        if so is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        try:
            result = sync_supplier_order(so, actor=request.user)
        except SupplierError as exc:
            return Response({"detail": str(exc), "code": "supplier_disabled"}, status=409)
        so.refresh_from_db()
        record_audit(
            request.user, "suppliers.order_checked", entity_type="SupplierOrder", entity_id=so.pk,
            meta={"supplier_order_number": so.supplier_ref, "result": result, "status": so.status},
        )
        return Response({"result": result, "supplier_order": supplier_order_payload(so)})


class _OrderItemSupplierBase(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "orders.fulfill"

    def _respond(self, order, so, result: str):
        from commerce.views import admin_order_payload

        body = dict(admin_order_payload(order))
        body["supplier_action"] = {"result": result, "supplier_order": supplier_order_payload(so) if so else None}
        return Response(body)

    @staticmethod
    def _error(exc: SupplierActionError):
        return Response({"detail": exc.message, "code": exc.code}, status=exc.status)


class OrderItemSupplierCheckView(_OrderItemSupplierBase):
    """POST admin/orders/<order>/items/<item_id>/supplier/check/"""

    def post(self, request, pk, item_id: int):
        from commerce.views import get_admin_order

        order = get_admin_order(pk)
        try:
            so = staff_check(order, item_id, actor=request.user)
        except SupplierActionError as exc:
            return self._error(exc)
        return self._respond(order, so, so.status.lower())


class OrderItemSupplierPurchaseView(_OrderItemSupplierBase):
    """POST admin/orders/<order>/items/<item_id>/supplier/retry/ | .../supplier/buy/  body {confirm: true}"""

    mode = "retry"

    def post(self, request, pk, item_id: int):
        from commerce.views import get_admin_order

        if _truthy(request.data.get("confirm")) is not True:
            return Response(
                {"detail": "Confirm the supplier purchase (send confirm: true)", "code": "confirmation_required"},
                status=400,
            )
        order = get_admin_order(pk)
        try:
            so = staff_purchase(order, item_id, actor=request.user, mode=self.mode)
        except SupplierActionError as exc:
            return self._error(exc)
        return self._respond(order, so, so.status.lower())


class OrderItemSupplierBuyView(OrderItemSupplierPurchaseView):
    mode = "buy_now"


# --- Alerts ----------------------------------------------------------------------------------------


def alert_payload(alert: SupplierAlert) -> dict:
    return {
        "id": alert.id,
        "kind": alert.kind,
        "kind_label": AlertKind(alert.kind).label if alert.kind in AlertKind.values else alert.kind,
        "severity": alert.severity,
        "message": alert.message,
        "order_number": alert.order_number or None,
        "supplier_order_id": alert.supplier_order_id,
        "occurrences": alert.occurrences,
        "meta": alert.meta,
        "resolved": alert.resolved,
        "resolved_at": alert.resolved_at,
        "resolved_by": alert.resolved_by.email if alert.resolved_by_id else None,
        "resolution_note": alert.resolution_note,
        "created_at": alert.created_at,
        "updated_at": alert.updated_at,
    }


class SupplierAlertListView(generics.ListAPIView):
    """GET admin/1epin/alerts/?status=open|resolved|all&kind="""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = ("suppliers.read", "suppliers.write")
    filter_backends: list = []

    def get_queryset(self):
        params = self.request.query_params
        qs = SupplierAlert.objects.select_related("resolved_by")
        state = (params.get("status") or "open").lower()
        if state == "open":
            qs = qs.filter(resolved=False)
        elif state == "resolved":
            qs = qs.filter(resolved=True)
        if params.get("kind"):
            qs = qs.filter(kind=params["kind"])
        return qs.order_by("resolved", "-updated_at", "-id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([alert_payload(a) for a in page])


class SupplierAlertResolveView(APIView):
    """POST admin/1epin/alerts/<id>/resolve/ {note?}"""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request, alert_id: int):
        alert = SupplierAlert.objects.filter(pk=alert_id).first()
        if alert is None:
            return Response({"detail": "Not found", "code": "not_found"}, status=404)
        if alert.resolved:
            return Response({"detail": "Alert is already resolved", "code": "already_resolved"}, status=409)
        resolve_alert(alert, actor=request.user, note=str(request.data.get("note") or ""))
        record_audit(
            request.user, "suppliers.alert_resolved", entity_type="SupplierAlert", entity_id=alert.pk,
            meta={"kind": alert.kind, "order_number": alert.order_number},
        )
        return Response(alert_payload(alert))


# --- Public callback / reconcile -------------------------------------------------------------------


def _plain(text: str, status_code: int = 200) -> HttpResponse:
    return HttpResponse(text, status=status_code, content_type="text/plain; charset=utf-8")


class OneEpinCallbackView(APIView):
    """1Epin order callback. Token in the URL path (as registered on 1Epin) or ``X-Callback-Token``.

    The payload is unsigned, so it is only a hint: the order is confirmed with checkOrder before
    anything is applied. Replies plain-text ``OK`` once the event is stored (even for unknown orders).
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    throttle_scope = "supplier_callback"

    def post(self, request, token: str = ""):
        expected = settings.ONEEPIN_CALLBACK_TOKEN or ""
        supplied = request.headers.get("X-Callback-Token") or token or ""
        if not expected or not secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            return _plain("Unauthorized", 401)
        try:
            raw = request.data
            payload = raw.dict() if hasattr(raw, "dict") else (dict(raw) if isinstance(raw, dict) else {})
        except Exception:  # noqa: BLE001 - malformed body: still record it
            payload = {}
        order_number = str(payload.get("OrderNumber") or payload.get("orderNumber") or "").strip()[:120]
        status_code = str(payload.get("OrderStatusCode", payload.get("ResultCode", "")))[:8]
        safe = sanitize_payload(payload)
        so = SupplierOrder.objects.filter(supplier_ref=order_number).first() if order_number else None
        if not order_number:
            reason = "missing_order_number"
        elif so is None:
            reason = "no_matching_supplier_order"
        else:
            reason = "received"
        dedupe = f"1epin:{order_number}:{status_code}"[:255]
        event, created = SupplierWebhookEvent.objects.get_or_create(
            dedupe_key=dedupe,
            defaults={"supplier_ref": order_number, "payload": safe, "processed": False, "reason": reason},
        )
        if so is None:
            logger.warning("1Epin callback for unknown order %r (%s)", order_number, reason)
            return _plain("OK")
        if event.processed and so.status == SupplierStatus.COMPLETED:
            return _plain("OK")
        try:
            result = sync_supplier_order(so)
            event.processed = True
            event.reason = f"confirmed_by_check_order:{result}"[:255]
        except Exception as exc:  # noqa: BLE001 - always answer OK; reconcile will retry
            logger.exception("1Epin callback processing failed for %s", order_number)
            event.reason = f"check_failed:{exc.__class__.__name__}"[:255]
        event.processed_at = timezone.now()
        event.save(update_fields=["processed", "reason", "processed_at"])
        return _plain("OK")


class OneEpinReconcileView(APIView):
    """POST suppliers/1epin/reconcile/ (Bearer ONEEPIN_RECONCILE_TOKEN) -> run the 1Epin jobs now."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "supplier_callback"

    def post(self, request):
        auth = request.headers.get("Authorization", "")
        token = settings.ONEEPIN_RECONCILE_TOKEN or ""
        if not token or not secrets.compare_digest(auth.encode("utf-8"), f"Bearer {token}".encode("utf-8")):
            return Response({"detail": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
        summary = reconcile_supplier_orders()
        reconciled = summary.get("checked", 0) if isinstance(summary, dict) else 0
        return Response({"ok": True, "reconciled": reconciled, "summary": summary, "message": f"{reconciled} supplier order(s) checked"})


class SupplierLogsView(APIView):
    """GET admin/1epin/logs/?order_number=&action= (latest 50 / 200)."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        qs = SupplierApiLog.objects.select_related("supplier")
        if request.query_params.get("order_number"):
            qs = qs.filter(order_number=request.query_params["order_number"])
        if request.query_params.get("action"):
            qs = qs.filter(action=request.query_params["action"])
        return Response(
            [
                {
                    "id": log.id,
                    "supplier": log.supplier.slug,
                    "action": log.action,
                    "ok": log.ok,
                    "result_code": log.result_code,
                    "order_number": log.order_number,
                    "duration_ms": log.duration_ms,
                    "environment": log.environment,
                    "message": log.message,
                    "created_at": log.created_at,
                }
                for log in qs[:50]
            ]
        )
