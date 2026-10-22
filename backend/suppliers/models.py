from __future__ import annotations

from django.db import models

from catalog.models import Product, ProductVariant


class SupplierEnvironment(models.TextChoices):
    MOCK = "MOCK", "Mock"
    TEST = "TEST", "Test"
    LIVE = "LIVE", "Live"


class SupplierStatus(models.TextChoices):
    NOT_SUBMITTED = "NOT_SUBMITTED", "Not submitted"
    SUBMITTING = "SUBMITTING", "Submitting"
    PROCESSING = "PROCESSING", "Processing"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"
    UNKNOWN = "UNKNOWN", "Unknown"


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
    meta = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class SupplierProductMapping(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="mappings")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="supplier_mappings")
    variant = models.ForeignKey(
        ProductVariant, null=True, blank=True, on_delete=models.CASCADE, related_name="supplier_mappings"
    )
    external_product_id = models.CharField(max_length=120)
    external_name = models.CharField(max_length=255, blank=True)
    ignored = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("supplier", "external_product_id")


class SupplierOrder(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="orders")
    order_item_id = models.IntegerField()
    supplier_ref = models.CharField(max_length=120, unique=True)
    status = models.CharField(max_length=32, choices=SupplierStatus.choices, default=SupplierStatus.NOT_SUBMITTED)
    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class SupplierWebhookEvent(models.Model):
    dedupe_key = models.CharField(max_length=255, unique=True)
    supplier_ref = models.CharField(max_length=120, blank=True)
    payload = models.JSONField(default=dict)
    processed = models.BooleanField(default=False)
    reason = models.CharField(max_length=255, blank=True, help_text="Why the event was not processed")
    created_at = models.DateTimeField(auto_now_add=True)


class SupplierApiLog(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="api_logs")
    action = models.CharField(max_length=64)
    ok = models.BooleanField(default=False)
    status_code = models.IntegerField(null=True, blank=True)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
