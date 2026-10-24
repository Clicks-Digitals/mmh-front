from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.models import CustomerProfile, UserKind
from accounts.permissions import user_permissions
from accounts.validators import normalize_phone

User = get_user_model()


def run_password_validators(password: str, user=None, *, field: str = "password") -> None:
    """Run AUTH_PASSWORD_VALIDATORS and convert failures to a DRF field error on ``field``."""
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({field: list(exc.messages)}) from exc


def validate_phone_value(value: str) -> str:
    """DRF-friendly wrapper around :func:`accounts.validators.normalize_phone`."""
    try:
        return normalize_phone(value)
    except ValueError as exc:
        raise serializers.ValidationError(str(exc)) from exc


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True, trim_whitespace=False)
    full_name = serializers.CharField(max_length=160)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email already registered")
        return value

    def validate_phone(self, value: str) -> str:
        return validate_phone_value(value)

    def validate(self, attrs):
        candidate = User(email=attrs.get("email", ""), first_name=attrs.get("full_name", ""))
        run_password_validators(attrs.get("password", ""), user=candidate)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            first_name=validated_data["full_name"],
            kind=UserKind.CUSTOMER,
        )
        CustomerProfile.objects.create(user=user, phone=validated_data.get("phone", ""))
        return user


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class MeSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "kind", "role", "permissions", "phone")

    def get_role(self, obj):
        profile = getattr(obj, "admin_profile", None)
        return profile.role if profile else None

    def get_permissions(self, obj):
        return sorted(user_permissions(obj))

    def get_phone(self, obj):
        profile = getattr(obj, "customer_profile", None)
        return profile.phone if profile else ""


class MeUpdateSerializer(serializers.Serializer):
    """PATCH /auth/me/ — the signed-in user edits their own name / phone."""

    first_name = serializers.CharField(max_length=150, required=False, allow_blank=False, trim_whitespace=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, trim_whitespace=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)

    def validate_phone(self, value: str) -> str:
        user = self.context["request"].user
        if user.kind != UserKind.CUSTOMER:
            raise serializers.ValidationError("Phone can only be set on customer accounts")
        return validate_phone_value(value)

    @transaction.atomic
    def update(self, user, validated_data):
        fields = [f for f in ("first_name", "last_name") if f in validated_data]
        for f in fields:
            setattr(user, f, validated_data[f])
        if fields:
            user.save(update_fields=fields)
        if "phone" in validated_data:
            profile, _ = CustomerProfile.objects.get_or_create(user=user)
            profile.phone = validated_data["phone"]
            profile.save(update_fields=["phone", "updated_at"])
            # Drop a cached reverse relation so MeSerializer reads the new phone.
            user._state.fields_cache.pop("customer_profile", None)
        return user


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        if attrs["new_password"] == attrs["current_password"]:
            raise serializers.ValidationError({"new_password": ["New password must be different from the current one"]})
        run_password_validators(attrs["new_password"], user=user, field="new_password")
        return attrs
