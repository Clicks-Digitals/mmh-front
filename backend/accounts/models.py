from __future__ import annotations

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserKind(models.TextChoices):
    CUSTOMER = "CUSTOMER", "Customer"
    ADMIN = "ADMIN", "Admin"


class AdminRole(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super admin"
    ADMIN = "ADMIN", "Admin"
    CATALOG_MANAGER = "CATALOG_MANAGER", "Catalog manager"
    ORDER_MANAGER = "ORDER_MANAGER", "Order manager"
    CONTENT_MANAGER = "CONTENT_MANAGER", "Content manager"
    SUPPORT_AGENT = "SUPPORT_AGENT", "Support agent"
    VIEWER = "VIEWER", "Viewer"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, username=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("kind", UserKind.ADMIN)
        return self._create_user(email, password, **extra)


class User(AbstractUser):
    username = models.CharField(max_length=150, blank=True)
    email = models.EmailField(unique=True)
    kind = models.CharField(max_length=20, choices=UserKind.choices, default=UserKind.CUSTOMER)
    disabled = models.BooleanField(default=False)
    # Embedded in every JWT as the ``tv`` claim. Bumping it (password change/reset, disable,
    # role change) invalidates all outstanding access tokens immediately.
    token_version = models.PositiveIntegerField(default=0)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    def __str__(self) -> str:
        return self.email


class AdminProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="admin_profile")
    role = models.CharField(max_length=32, choices=AdminRole.choices)
    title = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user.email} ({self.role})"


class Permission(models.Model):
    key = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=255)

    def __str__(self) -> str:
        return self.key


class RolePermission(models.Model):
    role = models.CharField(max_length=32, choices=AdminRole.choices)
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="roles")

    class Meta:
        unique_together = ("role", "permission")


class CustomerProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="customer_profile")
    phone = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=32, default="active")
    locale = models.CharField(max_length=8, default="en")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.user.email
