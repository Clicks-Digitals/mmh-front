from __future__ import annotations

import secrets

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.drf_permissions import HasAdminPermission, IsAdminUser
from audit.services import AuditedModelViewSetMixin
from suppliers.models import (
    Supplier,
    SupplierApiLog,
    SupplierConnection,
    SupplierOrder,
    SupplierProductMapping,
    SupplierWebhookEvent,
)
from suppliers.provider import (
    SupplierError,
    ensure_mock_supplier,
    get_supplier_provider,
    log_supplier_action,
)


class SupplierSerializer(serializers.ModelSerializer):
    environment = serializers.CharField(source="connection.environment", read_only=True)
    email_configured = serializers.BooleanField(source="connection.email_configured", read_only=True)
    password_configured = serializers.BooleanField(source="connection.password_configured", read_only=True)
    callback_configured = serializers.BooleanField(source="connection.callback_configured", read_only=True)
    last_balance = serializers.CharField(source="connection.last_balance", read_only=True)
    last_checked_at = serializers.DateTimeField(source="connection.last_checked_at", read_only=True)

    class Meta:
        model = Supplier
        fields = (
            "id",
            "slug",
            "name",
            "active",
            "created_at",
            "environment",
            "email_configured",
            "password_configured",
            "callback_configured",
            "last_balance",
            "last_checked_at",
        )
        read_only_fields = ("created_at",)


class SupplierWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ("slug", "name", "active")


class SupplierMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierProductMapping
        fields = (
            "id",
            "product",
            "variant",
            "external_product_id",
            "external_name",
            "ignored",
            "created_at",
        )


class SupplierOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierOrder
        fields = ("id", "order_item_id", "supplier_ref", "status", "created_at", "updated_at")


class SupplierLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierApiLog
        fields = ("id", "action", "ok", "status_code", "message", "created_at")


class AdminSupplierViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    audit_prefix = "supplier"
    permission_classes = [IsAdminUser, HasAdminPermission]
    queryset = Supplier.objects.select_related("connection").all()
    search_fields = ["slug", "name"]
    filterset_fields = ["active"]

    def get_permissions(self):
        self.admin_permission = "suppliers.read" if self.action in {"list", "retrieve"} else "suppliers.write"
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return SupplierWriteSerializer
        return SupplierSerializer

    def retrieve(self, request, *args, **kwargs):
        supplier = self.get_object()
        data = SupplierSerializer(supplier).data
        data["mappings"] = SupplierMappingSerializer(supplier.mappings.select_related("product", "variant")[:50], many=True).data
        data["recent_orders"] = SupplierOrderSerializer(supplier.orders.order_by("-created_at")[:20], many=True).data
        data["recent_logs"] = SupplierLogSerializer(supplier.api_logs.order_by("-created_at")[:20], many=True).data
        data["live_locked"] = True
        return Response(data)

    def perform_create(self, serializer):
        super().perform_create(serializer)
        SupplierConnection.objects.get_or_create(supplier=serializer.instance)

    def _audit_label(self, instance) -> dict:
        return {"slug": instance.slug, "name": instance.name, "active": instance.active}


def supplier_status_payload(supplier: Supplier) -> dict:
    """Shape shared by status, ping and balance responses."""
    connection = supplier.connection
    meta = connection.meta or {}
    return {
        "supplier": supplier.slug,
        "mode": settings.SUPPLIER_MODE,
        "environment": connection.environment,
        "email_configured": connection.email_configured,
        "password_configured": connection.password_configured,
        "callback_configured": connection.callback_configured,
        "last_balance": connection.last_balance,
        "last_balance_currency": meta.get("balance_currency", ""),
        "last_checked_at": connection.last_checked_at,
        "live_locked": True,
    }


def _balance_payload(supplier: Supplier, *, ok: bool, message: str, cached: bool) -> dict:
    connection = supplier.connection
    currency = (connection.meta or {}).get("balance_currency", "")
    return {
        "ok": ok,
        "cached": cached,
        "balance": connection.last_balance or None,
        # ``amount`` kept for older panel builds.
        "amount": connection.last_balance or None,
        "currency": currency,
        "last_checked_at": connection.last_checked_at,
        "message": message,
    }


class SupplierStatusView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        supplier = ensure_mock_supplier()
        return Response(supplier_status_payload(supplier))


class SupplierPingView(APIView):
    """Runs a connection check; returns the status object plus ``ok`` and ``message``."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_mock_supplier()
        try:
            provider = get_supplier_provider()
            result = provider.check_connection()
        except SupplierError as exc:
            log_supplier_action(supplier, "ping", False, str(exc))
            payload = supplier_status_payload(supplier)
            payload.update({"ok": False, "message": str(exc), "detail": str(exc)})
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        ok = bool(result.get("ok"))
        message = str(result.get("message", ""))
        log_supplier_action(supplier, "ping", ok, message)
        connection = supplier.connection
        connection.last_checked_at = timezone.now()
        connection.save(update_fields=["last_checked_at", "updated_at"])
        payload = supplier_status_payload(supplier)
        payload.update({"ok": ok, "message": message})
        return Response(payload)


class SupplierBalanceView(APIView):
    """Read-only: last cached balance. Use POST balance/refresh/ to query the supplier."""

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        supplier = ensure_mock_supplier()
        has_value = bool(supplier.connection.last_balance)
        message = "Last cached balance" if has_value else "Balance has not been fetched yet"
        return Response(_balance_payload(supplier, ok=has_value, message=message, cached=True))


class SupplierBalanceRefreshView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_mock_supplier()
        try:
            provider = get_supplier_provider()
            bal = provider.get_balance()
        except SupplierError as exc:
            log_supplier_action(supplier, "balance", False, str(exc))
            payload = _balance_payload(supplier, ok=False, message=str(exc), cached=True)
            payload["detail"] = str(exc)
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        log_supplier_action(supplier, "balance", bal.ok, bal.message)
        connection = supplier.connection
        connection.last_checked_at = timezone.now()
        fields = ["last_checked_at", "updated_at"]
        if bal.ok:
            connection.last_balance = bal.amount
            meta = dict(connection.meta or {})
            meta["balance_currency"] = bal.currency
            connection.meta = meta
            fields += ["last_balance", "meta"]
        connection.save(update_fields=fields)
        payload = _balance_payload(supplier, ok=bal.ok, message=bal.message, cached=not bal.ok)
        if not bal.ok:
            payload["detail"] = bal.message or "Supplier rejected the balance request"
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        return Response(payload)


class SupplierSyncView(APIView):
    """2xx only when the sync actually ran successfully.

    * 409 ``{ok: false, noop: true, detail}`` when nothing could be synced (mock mode / not implemented)
    * 502 ``{ok: false, detail}`` when the supplier call failed
    """

    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.write"

    def post(self, request):
        supplier = ensure_mock_supplier()
        try:
            provider = get_supplier_provider()
            result = provider.sync_catalog()
        except SupplierError as exc:
            log_supplier_action(supplier, "sync", False, str(exc))
            return Response({"ok": False, "detail": str(exc), "message": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        ok = bool(result.get("ok"))
        message = str(result.get("message", ""))
        log_supplier_action(supplier, "sync", ok, message)
        body = {**result, "ok": ok, "message": message}
        if ok:
            return Response(body)
        body["detail"] = message or "Sync did not run"
        code = status.HTTP_409_CONFLICT if result.get("noop") else status.HTTP_502_BAD_GATEWAY
        return Response(body, status=code)


class OneEpinCallbackView(APIView):
    """1Epin order callback. Token via ``X-Callback-Token`` header (preferred) or the URL path."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "supplier_callback"

    def post(self, request, token: str = ""):
        expected = settings.ONEEPIN_CALLBACK_TOKEN or ""
        supplied = request.headers.get("X-Callback-Token") or token or ""
        if not expected or not secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            return Response({"detail": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
        payload = request.data if isinstance(request.data, dict) else {}
        order_number = str(payload.get("OrderNumber") or payload.get("orderNumber") or "")
        if not order_number:
            reason = "missing_order_number"
        elif SupplierOrder.objects.filter(supplier_ref=order_number).exists():
            reason = "recorded_for_manual_processing"
        else:
            reason = "no_matching_supplier_order"
        dedupe = f"1epin:{order_number}:{payload.get('ResultCode', '')}"
        event, created = SupplierWebhookEvent.objects.get_or_create(
            dedupe_key=dedupe[:255],
            defaults={
                "supplier_ref": order_number[:120],
                "payload": payload,
                "processed": False,
                "reason": reason,
            },
        )
        return Response(
            {"ok": True, "created": created, "id": event.id, "processed": event.processed, "reason": event.reason}
        )


class OneEpinReconcileView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "supplier_callback"

    def post(self, request):
        auth = request.headers.get("Authorization", "")
        token = settings.ONEEPIN_RECONCILE_TOKEN or ""
        if not token or not secrets.compare_digest(auth.encode("utf-8"), f"Bearer {token}".encode("utf-8")):
            return Response({"detail": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"ok": True, "reconciled": 0, "message": "No stale supplier orders"})


class SupplierLogsView(APIView):
    permission_classes = [IsAdminUser, HasAdminPermission]
    admin_permission = "suppliers.read"

    def get(self, request):
        logs = SupplierApiLog.objects.select_related("supplier")[:50]
        return Response(
            [
                {
                    "id": log.id,
                    "supplier": log.supplier.slug,
                    "action": log.action,
                    "ok": log.ok,
                    "message": log.message,
                    "created_at": log.created_at,
                }
                for log in logs
            ]
        )
