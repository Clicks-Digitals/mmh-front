from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.models import CustomerProfile, UserKind
from accounts.permissions import user_permissions

User = get_user_model()


def run_password_validators(password: str, user=None) -> None:
    """Run AUTH_PASSWORD_VALIDATORS and convert failures to a DRF field error on ``password``."""
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": list(exc.messages)}) from exc


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
