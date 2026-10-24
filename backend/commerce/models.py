from __future__ import annotations

import secrets

from django.conf import settings
from django.db import models

from catalog.models import Product, ProductVariant


def generate_access_token() -> str:
    """Random 32-char URL-safe secret that lets a guest open their order/codes."""
    return secrets.token_urlsafe(24)


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
    max_uses_per_customer = models.IntegerField(null=True, blank=True)
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


ORDER_LOCALES = [("en", "English"), ("ar", "Arabic")]


class Order(models.Model):
    order_number = models.CharField(max_length=32, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    email = models.EmailField()
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)
    # Internal staff notes (never shown to the customer). Edited via admin PATCH, audited.
    staff_notes = models.TextField(blank=True)
    # Customer language captured at checkout; every customer e-mail is sent in it.
    locale = models.CharField(max_length=2, choices=ORDER_LOCALES, default="en")
    # sha256 of the normalized cart (email, lines, fields, coupon, totals): reuse of open PENDING orders.
    cart_signature = models.CharField(max_length=64, blank=True, db_index=True)
    # Stock reservation (D2): set when a PayPal order is created; codes are held until then.
    reserved_until = models.DateTimeField(null=True, blank=True)
    # One-shot customer e-mails (D9).
    codes_email_sent_at = models.DateTimeField(null=True, blank=True)
    partial_email_sent_at = models.DateTimeField(null=True, blank=True)
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
    access_token = models.CharField(max_length=64, default=generate_access_token, editable=False)
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
    product_name_ar = models.CharField(max_length=255, blank=True)
    variant_name_ar = models.CharField(max_length=160, blank=True)
    customer_fields = models.JSONField(default=dict, blank=True)
    # [{key, label_en, label_ar, value}] in definition order, captured at checkout.
    field_details = models.JSONField(default=list, blank=True)
    delivery_method = models.CharField(max_length=32, blank=True)
    delivery_contact = models.CharField(max_length=255, blank=True)
    region_name = models.CharField(max_length=120, blank=True)
    region_name_ar = models.CharField(max_length=120, blank=True)
    platform_name = models.CharField(max_length=120, blank=True)
    platform_name_ar = models.CharField(max_length=120, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    delivery_note = models.TextField(blank=True)

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
    # D3: waiting MANUAL_REVIEW orders completed right after this import.
    auto_delivered_orders = models.IntegerField(default=0)
    preview_rows = models.JSONField(default=list, blank=True)
    pending_file_path = models.CharField(max_length=512, blank=True)
    # AES-GCM ciphertext (base64) of the normalized rows awaiting confirmation; cleared afterwards.
    pending_payload = models.TextField(blank=True)
    pending_payload_nonce = models.CharField(max_length=64, blank=True)
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
    # sha256 of the normalized CODE text only (PIN ignored): duplicate detection + full-code search.
    code_identity = models.CharField(max_length=64, null=True, blank=True, db_index=True)
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
    delivered_at = models.DateTimeField(null=True, blank=True)
    revealed_at = models.DateTimeField(null=True, blank=True)
    revealed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="revealed_codes"
    )
    # First time the customer revealed this code (order page / codes API).
    customer_revealed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"], name="commerce_dc_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Code {self.id} ({self.masked})"


class RefundStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"


class Refund(models.Model):
    """Refund ledger (D5). One row per refund, PayPal or recorded manually."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="refund_records")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="refund_records")
    provider = models.CharField(max_length=32, default="manual")
    status = models.CharField(max_length=16, choices=RefundStatus.choices, default=RefundStatus.COMPLETED)
    amount_fils = models.IntegerField()
    currency = models.CharField(max_length=8, default="JOD")
    provider_amount = models.CharField(max_length=32, blank=True)
    provider_currency = models.CharField(max_length=8, blank=True)
    provider_refund_id = models.CharField(max_length=64, blank=True, db_index=True)
    reason = models.CharField(max_length=500, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="refunds_issued"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"Refund {self.id} {self.amount_fils} fils ({self.provider})"
