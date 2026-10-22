from django.db import models


class BannerPlacement(models.TextChoices):
    HOME = "HOME", "Home"
    SHOP = "SHOP", "Shop"
    CATEGORY = "CATEGORY", "Category"
    PROMO = "PROMO", "Promo"


class Banner(models.Model):
    href = models.CharField(max_length=255)
    kicker = models.CharField(max_length=120, blank=True)
    tone = models.CharField(max_length=32, default="gold")
    placement = models.CharField(max_length=16, choices=BannerPlacement.choices, default=BannerPlacement.HOME)
    desktop_image = models.CharField(max_length=512, blank=True)
    mobile_image = models.CharField(max_length=512, blank=True)
    title_en = models.CharField(max_length=255)
    title_ar = models.CharField(max_length=255, blank=True)
    subtitle_en = models.CharField(max_length=255, blank=True)
    subtitle_ar = models.CharField(max_length=255, blank=True)
    published = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "-created_at"]

    def __str__(self) -> str:
        return self.title_en


class FAQ(models.Model):
    question_en = models.CharField(max_length=255)
    question_ar = models.CharField(max_length=255, blank=True)
    answer_en = models.TextField()
    answer_ar = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    published = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order"]
        verbose_name = "FAQ"
        verbose_name_plural = "FAQs"


class ContentPage(models.Model):
    slug = models.SlugField(unique=True)
    title_en = models.CharField(max_length=255)
    title_ar = models.CharField(max_length=255, blank=True)
    body_en = models.TextField()
    body_ar = models.TextField(blank=True)
    published = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)


class SiteSettings(models.Model):
    """Singleton storefront/settings row — no secrets."""

    store_name = models.CharField(max_length=160, default="MMH")
    support_email = models.EmailField(blank=True)
    support_phone = models.CharField(max_length=40, blank=True)
    business_hours = models.CharField(max_length=160, blank=True)
    # Contact channels shown on the storefront. Empty values are hidden there.
    whatsapp_number = models.CharField(max_length=32, blank=True, help_text="International format, e.g. 962790000000")
    telegram_url = models.URLField(blank=True)
    instagram_url = models.URLField(blank=True)
    facebook_url = models.URLField(blank=True)
    tiktok_url = models.URLField(blank=True)
    youtube_url = models.URLField(blank=True)
    low_stock_threshold = models.IntegerField(default=5)
    maintenance_mode = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site settings"
        verbose_name_plural = "Site settings"

    def __str__(self) -> str:
        return self.store_name

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "SiteSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
