from __future__ import annotations

from django.conf import settings
from django.db import models

from catalog.models import Product, ProductVariant


class PaymentStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    AUTHORIZED = "AUTHORIZED", "Authorized"
    PAID = "PAID", "Paid"
    FAILED = "FAILED", "Failed"
    CANCELLED = "CANCELLED", "Cancelled"
    REFUNDED = "REFUNDED", "Refunded"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"


class FulfillmentStatus(models.TextChoices):
    NOT_STARTED = "NOT_STARTED", "Not started"
    QUEUED = "QUEUED", "Queued"
    PROCESSING = "PROCESSING", "Processing"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"
    MANUAL_REVIEW = "MANUAL_REVIEW", "Manual review"
    CANCELLED = "CANCELLED", "Cancelled"


class Coupon(models.Model):
    code = models.CharField(max_length=40, unique=True)
    description = models.CharField(max_length=255, blank=True)
    percent_off = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amount_off_fils = models.IntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.IntegerField(null=True, blank=True)
    used_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.code


class DigitalCodeStatus(models.TextChoices):
    AVAILABLE = "AVAILABLE", "Available"
    RESERVED = "RESERVED", "Reserved"
    DELIVERED = "DELIVERED", "Delivered"
    UNAVAILABLE = "UNAVAILABLE", "Unavailable"


class DigitalCodeSource(models.TextChoices):
    MANUAL = "MANUAL", "Manual"
    CSV_IMPORT = "CSV_IMPORT", "CSV / spreadsheet import"
    ONEEPIN = "ONEEPIN", "OneEpin"
    CHECKOUT_DEMO = "CHECKOUT_DEMO", "Checkout demo"


class CodeImportMode(models.TextChoices):
    SIMPLE = "SIMPLE", "Simple"
    ADVANCED = "ADVANCED", "Advanced"


class CodeImportBatchStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    VALIDATED = "VALIDATED", "Validated"
    PROCESSING = "PROCESSING", "Processing"
    COMPLETED = "COMPLETED", "Completed"
    PARTIAL = "PARTIAL", "Partial"
    FAILED = "FAILED", "Failed"


class Order(models.Model):
    order_number = models.CharField(max_length=32, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    email = models.EmailField()
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)
    coupon = models.ForeignKey(Coupon, null=True, blank=True, on_delete=models.SET_NULL)
    subtotal_fils = models.IntegerField(default=0)
    discount_fils = models.IntegerField(default=0)
    total_fils = models.IntegerField(default=0)
    currency = models.CharField(max_length=8, default="JOD")
    payment_status = models.CharField(
        max_length=32, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    fulfillment_status = models.CharField(
        max_length=32, choices=FulfillmentStatus.choices, default=FulfillmentStatus.NOT_STARTED
    )
    idempotency_key = models.CharField(max_length=255, blank=True, db_index=True)
    region_confirmed = models.BooleanField(default=False)
    refund_confirmed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["email"], name="commerce_or_email_idx"),
            models.Index(fields=["payment_status"], name="commerce_or_pay_st_idx"),
            models.Index(fields=["fulfillment_status"], name="commerce_or_ful_st_idx"),
        ]

    def __str__(self) -> str:
        return self.order_number

    @property
    def total_jod(self) -> float:
        return self.total_fils / 1000.0


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
    unit_price_fils = models.IntegerField()
    line_total_fils = models.IntegerField()
    product_name = models.CharField(max_length=255)
    variant_name = models.CharField(max_length=160)
    customer_fields = models.JSONField(default=dict, blank=True)
    delivery_method = models.CharField(max_length=32, blank=True)
    delivery_contact = models.CharField(max_length=255, blank=True)
    region_name = models.CharField(max_length=120, blank=True)
    platform_name = models.CharField(max_length=120, blank=True)

    def __str__(self) -> str:
        return f"{self.product_name} x{self.quantity}"


class Payment(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="payments")
    provider = models.CharField(max_length=64, default="placeholder")
    status = models.CharField(max_length=32, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    amount_fils = models.IntegerField()
    currency = models.CharField(max_length=8, default="JOD")
    provider_amount = models.CharField(max_length=32, blank=True)
    provider_order_id = models.CharField(max_length=64, null=True, blank=True)
    provider_capture_id = models.CharField(max_length=64, null=True, blank=True)
    external_ref = models.CharField(max_length=255, blank=True, db_index=True)
    checkout_token = models.CharField(max_length=64, blank=True)
    raw = models.JSONField(default=dict, blank=True)
    raw_create_response = models.JSONField(null=True, blank=True)
    raw_capture_response = models.JSONField(null=True, blank=True)
    raw_refund_response = models.JSONField(null=True, blank=True)
    refunds = models.JSONField(default=list, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider_order_id"],
                condition=models.Q(provider_order_id__isnull=False),
                name="uniq_paypal_order_id",
            ),
            models.UniqueConstraint(
                fields=["provider_capture_id"],
                condition=models.Q(provider_capture_id__isnull=False),
                name="uniq_paypal_capture_id",
            ),
        ]


class PayPalWebhookEvent(models.Model):
    """Processed PayPal webhook ids. Replays of the same event are ignored."""

    event_id = models.CharField(max_length=64, unique=True)
    event_type = models.CharField(max_length=128)
    processed = models.BooleanField(default=False)
    summary = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class CodeImportBatch(models.Model):
    """Tracks bulk digital-code imports. Never stores plaintext codes."""

    filename = models.CharField(max_length=255)
    mode = models.CharField(max_length=16, choices=CodeImportMode.choices, default=CodeImportMode.SIMPLE)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="code_import_batches",
    )
    variant = models.ForeignKey(
        ProductVariant,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="code_import_batches",
    )
    status = models.CharField(
        max_length=16, choices=CodeImportBatchStatus.choices, default=CodeImportBatchStatus.PENDING
    )
    total_rows = models.IntegerField(default=0)
    valid_rows = models.IntegerField(default=0)
    imported_rows = models.IntegerField(default=0)
    duplicate_rows = models.IntegerField(default=0)
    failed_rows = models.IntegerField(default=0)
    error_report = models.JSONField(default=list, blank=True)
    preview_rows = models.JSONField(default=list, blank=True)
    pending_file_path = models.CharField(max_length=512, blank=True)
    file_sha256 = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"ImportBatch {self.id} ({self.status})"


class DigitalCode(models.Model):
    order_item = models.ForeignKey(
        OrderItem, null=True, blank=True, on_delete=models.CASCADE, related_name="codes"
    )
    variant = models.ForeignKey(
        ProductVariant, null=True, blank=True, on_delete=models.SET_NULL, related_name="digital_codes"
    )
    status = models.CharField(
        max_length=16, choices=DigitalCodeStatus.choices, default=DigitalCodeStatus.DELIVERED
    )
    source = models.CharField(
        max_length=32, choices=DigitalCodeSource.choices, default=DigitalCodeSource.MANUAL, blank=True
    )
    code_fingerprint = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    import_batch = models.ForeignKey(
        CodeImportBatch,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="codes",
    )
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="imported_codes",
    )
    ciphertext = models.TextField()
    nonce = models.CharField(max_length=64)
    masked = models.CharField(max_length=64)
    revealed_at = models.DateTimeField(null=True, blank=True)
    revealed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="revealed_codes"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"], name="commerce_dc_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Code {self.id} ({self.masked})"
