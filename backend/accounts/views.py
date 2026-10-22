from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.authentication import revoke_refresh_tokens, user_can_authenticate
from accounts.serializers import (
    LogoutSerializer,
    MeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    run_password_validators,
)

User = get_user_model()
logger = logging.getLogger("accounts")

password_reset_token_generator = PasswordResetTokenGenerator()

PASSWORD_RESET_REQUEST_DETAIL = (
    "If an account exists for that email, a password reset link has been sent."
)


def find_user_by_email(email: str):
    """Case-insensitive lookup; prefers an exact-case match if legacy duplicates exist."""
    email = (email or "").strip()
    if not email:
        return None
    exact = User.objects.filter(email=email).first()
    if exact:
        return exact
    return User.objects.filter(email__iexact=email).order_by("id").first()


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = User.EMAIL_FIELD

    def validate(self, attrs):
        user = find_user_by_email(attrs.get(self.username_field, ""))
        if user is not None:
            attrs[self.username_field] = user.email
        data = super().validate(attrs)
        if not user_can_authenticate(self.user):  # defensive; USER_AUTHENTICATION_RULE also rejects
            raise AuthenticationFailed("Account disabled")
        data["user"] = MeSerializer(self.user).data
        return data


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer
    throttle_scope = "login"


class RotatingTokenRefreshView(TokenRefreshView):
    """Refresh rotates the refresh token and blacklists the old one (see SIMPLE_JWT)."""

    throttle_scope = "token_refresh"


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_scope = "register"

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)


class LogoutView(APIView):
    """Blacklist the supplied refresh token. Works with an expired access token."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_scope = "logout"

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        raw = serializer.validated_data["refresh"]
        try:
            token = RefreshToken(raw)
        except TokenError as exc:
            if "blacklisted" in str(exc).lower():
                return Response({"detail": "Logged out"})
            return Response({"detail": "Invalid or expired refresh token"}, status=status.HTTP_400_BAD_REQUEST)
        token.blacklist()
        return Response({"detail": "Logged out"})


def build_password_reset_link(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = password_reset_token_generator.make_token(user)
    base = (getattr(settings, "SITE_URL", "") or "").rstrip("/")
    return f"{base}/reset-password?uid={uid}&token={token}"


def send_password_reset_email(user) -> None:
    link = build_password_reset_link(user)
    store = "MMH"
    try:
        from cms.models import SiteSettings

        store = SiteSettings.load().store_name or store
    except Exception:  # noqa: BLE001 — never block a reset on CMS settings
        pass
    subject = f"Reset your {store} password"
    body = (
        f"Hello,\n\n"
        f"We received a request to reset the password for your {store} account.\n"
        f"Open this link to choose a new password:\n\n{link}\n\n"
        f"If you did not ask for this, you can ignore this email; your password will not change.\n"
    )
    support = getattr(settings, "SUPPORT_EMAIL", "")
    if support:
        body += f"\nNeed help? Contact {support}.\n"
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)


class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_email(serializer.validated_data["email"])
        if user is not None and user_can_authenticate(user):
            try:
                send_password_reset_email(user)
            except Exception:  # noqa: BLE001 — same response either way (no enumeration)
                logger.exception("Password reset email failed for user_id=%s", user.pk)
        return Response({"detail": PASSWORD_RESET_REQUEST_DETAIL})


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_scope = "password_reset_confirm"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invalid = Response(
            {"detail": "Invalid or expired password reset link", "code": "invalid_token"},
            status=status.HTTP_400_BAD_REQUEST,
        )
        try:
            pk = force_str(urlsafe_base64_decode(data["uid"]))
            user = User.objects.get(pk=pk)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return invalid
        if not user_can_authenticate(user) or not password_reset_token_generator.check_token(user, data["token"]):
            return invalid
        run_password_validators(data["password"], user=user)
        user.set_password(data["password"])
        user.save(update_fields=["password"])
        revoke_refresh_tokens(user)
        if user.kind == "ADMIN":
            from audit.services import record_audit

            record_audit(None, "admin.password_reset_via_email", entity_type="User", entity_id=user.pk)
        return Response({"detail": "Password has been reset"})
