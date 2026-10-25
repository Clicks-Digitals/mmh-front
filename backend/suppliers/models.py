from __future__ import annotations

from django.conf import settings
from django.db import models

from catalog.models import Product, ProductVariant


class SupplierEnvironment(models.TextChoices):
    MOCK = "MOCK", "Mock"
    TEST = "TEST", "Test"
    LIVE = "LIVE", "Live"


class SupplierStatus(models.TextChoices):
    NOT_SUBMITTED = "NOT_SUBMITTED", "Not submitted"
    SUBMITTING = "SUBMITTING", "Submitting"
    PROCESSING = "PROCESSING", "Processing at 1Epin"
    WAITING = "WAITING", "Waiting (1Epin service window)"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"
    MANUAL_REVIEW = "MANUAL_REVIEW", "Needs manual review"
    UNKNOWN = "UNKNOWN", "Unknown (checking with 1Epin)"


# Supplier orders that may still turn into a purchase at 1Epin (never start another attempt).
IN_FLIGHT_STATUSES = (
    SupplierStatus.NOT_SUBMITTED,
    SupplierStatus.SUBMITTING,
    SupplierStatus.PROCESSING,
    SupplierStatus.WAITING,
    SupplierStatus.UNKNOWN,
)


class Supplier(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=120)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class SupplierConnection(models.Model):
    supplier = models.OneToOneField(Supplier, on_delete=models.CASCADE, related_name="connection")
    environment = models.CharField(
        max_length=16, choices=SupplierEnvironment.choices, default=SupplierEnvironment.MOCK
    )
    base_url = models.CharField(max_length=255, blank=True)
    email_configured = models.BooleanField(default=False)
    password_configured = models.BooleanField(default=False)
    callback_configured = models.BooleanField(default=False)
    last_balance = models.CharField(max_length=32, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_catalog_sync_at = models.DateTimeField(null=True, blank=True)
    last_catalog_sync_result = models.JSONField(default=dict, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class SupplierCatalogItem(models.Model):
    """Cached remote product (1Epin ``allProducts``), one row per supplier environment."""

    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="catalog_items")
    environment = models.CharField(max_length=16, choices=SupplierEnvironment.choices)
    external_product_id = models.CharField(max_length=64)
    external_category_id = models.CharField(max_length=64, blank=True)
    category_name = models.CharField(max_length=255, blank=True)
    category_type = models.CharField(max_length=32, blank=True)
    product_name = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=14, decimal_places=4)
    previous_price = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=8, default="USD")
    is_tiered = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category_name", "product_name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["supplier", "environment", "external_product_id"], name="uniq_supplier_catalog_item"
            )
        ]
        indexes = [models.Index(fields=["supplier", "environment", "active"], name="suppliers_cat_env_idx")]

    def __str__(self) -> str:
        return f"{self.product_name} ({self.external_product_id})"


class SupplierProductMapping(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="mappings")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="supplier_mappings")
    variant = models.ForeignKey(
        ProductVariant, null=True, blank=True, on_delete=models.CASCADE, related_name="supplier_mappings"
    )
    external_product_id = models.CharField(max_length=120)
    external_name = models.CharField(max_length=255, blank=True)
    ignored = models.BooleanField(default=False)
    catalog_item = models.ForeignKey(
        SupplierCatalogItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="mappings"
    )
    category_type = models.CharField(max_length=32, blank=True)
    # How many supplier units make one of our units (e.g. 2 x "50 UC" = our "100 UC").
    quantity_per_unit = models.PositiveIntegerField(default=1)
    # False: deliver from own stock first and buy only what is missing.
    prefer_supplier = models.BooleanField(default=False)
    auto_buy = models.BooleanField(default=True)
    max_cost_fils = models.IntegerField(null=True, blank=True)
    allow_loss = models.BooleanField(default=False)
    # Top-up player id format, e.g. "{userId}({zoneId})". Blank = the first customer field.
    user_template = models.CharField(max_length=255, blank=True)
    # Only for tiered ("barem") products.
    barem = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class SupplierOrder(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="orders")
    order = models.ForeignKey(
        "commerce.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="supplier_orders"
    )
    order_item_id = models.IntegerField(db_index=True)
    attempt = models.PositiveIntegerField(default=1)
    # Our unique 1Epin ``orderNumber`` (MMH-<order>-<item>-<attempt>).
    supplier_ref = models.CharField(max_length=120, unique=True)
    environment = models.CharField(
        max_length=16, choices=SupplierEnvironment.choices, default=SupplierEnvironment.MOCK
    )
    mapping = models.ForeignKey(
        SupplierProductMapping, null=True, blank=True, on_delete=models.SET_NULL, related_name="supplier_orders"
    )
    catalog_item = models.ForeignKey(
        SupplierCatalogItem, null=True, blank=True, on_delete=models.SET_NULL, related_name="supplier_orders"
    )
    external_product_id = models.CharField(max_length=64, blank=True)
    product_name = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=16, blank=True, help_text="epin | topup")
    quantity = models.PositiveIntegerField(default=0, help_text="Units requested from 1Epin")
    units = models.PositiveIntegerField(default=0, help_text="Our order-item units covered")
    player_user = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=32, choices=SupplierStatus.choices, default=SupplierStatus.NOT_SUBMITTED)
    # True once 1Epin accepted the order (addOrder 00, or 07 = already registered).
    placed = models.BooleanField(default=False)
    result_code = models.CharField(max_length=8, blank=True)
    order_status_code = models.IntegerField(null=True, blank=True)
    message = models.CharField(max_length=500, blank=True)
    unit_price = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    cost = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=8, blank=True)
    cost_fils = models.IntegerField(null=True, blank=True)
    balance_after = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    pins_received = models.PositiveIntegerField(default=0)
    codes_delivered = models.PositiveIntegerField(default=0)
    submit_count = models.PositiveIntegerField(default=0)
    check_count = models.PositiveIntegerField(default=0)
    retry_after = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    stuck_alerted = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Sanitized only: never the password, PinCodes masked.
    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["order_item_id", "attempt"], name="uniq_supplier_order_item_attempt")
        ]
        indexes = [models.Index(fields=["status", "updated_at"], name="suppliers_order_status_idx")]

    def __str__(self) -> str:
        return f"{self.supplier_ref} ({self.status})"


class AlertKind(models.TextChoices):
    LOW_BALANCE = "low_balance", "Low balance"
    CONFIG = "config", "Configuration"
    ORDER_FAILED = "order_failed", "Supplier order failed"
    PRICE_CHANGE = "price_change", "Price change"
    DUPLICATE_CODE = "duplicate_code", "Duplicate code"
    COST_LIMIT = "cost_limit", "Cost above limit"
    OUT_OF_STOCK = "out_of_stock", "Out of stock after payment"


class SupplierAlert(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="alerts")
    kind = models.CharField(max_length=32, choices=AlertKind.choices)
    severity = models.CharField(max_length=16, default="warning")
    message = models.CharField(max_length=500)
    order_number = models.CharField(max_length=32, blank=True)
    supplier_order = models.ForeignKey(
        SupplierOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name="alerts"
    )
    # Open alerts with the same key are updated instead of duplicated.
    dedupe_key = models.CharField(max_length=160, blank=True, db_index=True)
    meta = models.JSONField(default=dict, blank=True)
    occurrences = models.PositiveIntegerField(default=1)
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolution_note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["resolved", "-updated_at", "-id"]
        indexes = [models.Index(fields=["resolved", "kind"], name="suppliers_alert_open_idx")]


class SupplierWebhookEvent(models.Model):
    dedupe_key = models.CharField(max_length=255, unique=True)
    supplier_ref = models.CharField(max_length=120, blank=True)
    # PinCodes are masked before storage.
    payload = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    reason = models.CharField(max_length=255, blank=True, help_text="Why the event was not processed")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class SupplierApiLog(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="api_logs")
    action = models.CharField(max_length=64)
    ok = models.BooleanField(default=False)
    status_code = models.IntegerField(null=True, blank=True)
    result_code = models.CharField(max_length=8, blank=True)
    environment = models.CharField(max_length=16, blank=True)
    order_number = models.CharField(max_length=120, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
