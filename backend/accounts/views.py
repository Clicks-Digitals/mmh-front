from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.contrib.auth.models import update_last_login
from rest_framework import generics, permissions, status
from rest_framework.exceptions import APIException, AuthenticationFailed
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.authentication import (
    TOKEN_VERSION_CLAIM,
    VersionedRefreshToken,
    issue_tokens,
    revoke_all_sessions,
    user_can_authenticate,
)
from accounts.drf_permissions import client_ip
from accounts.models import UserKind
from accounts.serializers import (
    ChangePasswordSerializer,
    LogoutSerializer,
    MeSerializer,
    MeUpdateSerializer,
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


def is_staff_account(user) -> bool:
    return bool(user is not None and (user.kind == UserKind.ADMIN or user.is_superuser))


def _audit(actor, action: str, user, meta: dict) -> None:
    try:
        from audit.services import record_audit

        record_audit(actor, action, entity_type="User", entity_id=user.pk if user is not None else "", meta=meta)
    except Exception:  # noqa: BLE001 — never block auth on auditing
        logger.exception("Could not record %s audit entry", action)


class InvalidCredentials(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_code = "invalid_credentials"

    def __init__(self):
        super().__init__({"detail": "Incorrect email or password.", "code": "invalid_credentials"})


class AccountDisabled(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "account_disabled"

    def __init__(self):
        super().__init__(
            {"detail": "This account has been disabled. Contact support for help.", "code": "account_disabled"}
        )


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login with distinct outcomes (D14):

    * unknown email / wrong password -> 401 ``invalid_credentials``
    * correct password, disabled/inactive account -> 403 ``account_disabled``
    """

    username_field = User.EMAIL_FIELD
    token_class = VersionedRefreshToken

    def _portal(self) -> str:
        data = getattr(self, "initial_data", None) or {}
        try:
            return str(data.get("portal") or "").strip().lower()
        except AttributeError:
            return ""

    def validate(self, attrs):
        email = attrs.get(self.username_field, "")
        password = attrs.get("password", "")
        user = find_user_by_email(email)
        request = self.context.get("request")
        ip = client_ip(request) if request is not None else ""
        if user is None:
            User().set_password(password)  # equalise timing with the known-user path
            # RO-17: failed attempts on the admin portal are recorded even for unknown e-mails
            # (the panel login sends portal="admin"); store logins are never audited.
            if self._portal() == "admin":
                _audit(
                    None,
                    "auth.login_failed",
                    None,
                    {"email": str(email or "").strip().lower()[:254], "ip": ip, "reason": "unknown_email"},
                )
            raise InvalidCredentials()
        if not user.check_password(password):
            if is_staff_account(user):
                _audit(None, "auth.login_failed", user, {"email": user.email, "ip": ip, "reason": "invalid_credentials"})
            raise InvalidCredentials()
        if not user_can_authenticate(user):
            if is_staff_account(user):
                _audit(None, "auth.login_failed", user, {"email": user.email, "ip": ip, "reason": "account_disabled"})
            raise AccountDisabled()
        self.user = user
        refresh = self.get_token(user)
        data = {"refresh": str(refresh), "access": str(refresh.access_token)}
        if jwt_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, user)
        data["user"] = MeSerializer(user).data
        if is_staff_account(user):
            _audit(user, "auth.login", user, {"email": user.email, "ip": ip})
        return data


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer
    throttle_scope = "login"


class VersionedTokenRefreshSerializer(TokenRefreshSerializer):
    """Refresh re-stamps the current ``token_version`` (a role change only needs a refresh;
    password changes / disables blacklist the refresh tokens themselves)."""

    token_class = VersionedRefreshToken

    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        user_id = refresh.payload.get(jwt_settings.USER_ID_CLAIM, None)
        user = User.objects.filter(**{jwt_settings.USER_ID_FIELD: user_id}).first() if user_id else None
        if user is None or not user_can_authenticate(user):
            raise AuthenticationFailed("No active account found for the given token.", "no_active_account")
        refresh[TOKEN_VERSION_CLAIM] = int(user.token_version or 0)
        data = {"access": str(refresh.access_token)}
        if jwt_settings.ROTATE_REFRESH_TOKENS:
            if jwt_settings.BLACKLIST_AFTER_ROTATION:
                try:
                    refresh.blacklist()
                except AttributeError:
                    pass
            refresh.set_jti()
            refresh.set_exp()
            refresh.set_iat()
            refresh.outstand()
            data["refresh"] = str(refresh)
        return data


class RotatingTokenRefreshView(TokenRefreshView):
    """Refresh rotates the refresh token and blacklists the old one (see SIMPLE_JWT)."""

    serializer_class = VersionedTokenRefreshSerializer
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
    """GET the signed-in user; PATCH ``{first_name?, last_name?, phone?}`` (phone: customers only)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        serializer = MeUpdateSerializer(data=request.data, context={"request": request}, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.update(request.user, serializer.validated_data)
        return Response(MeSerializer(user).data)


class ChangePasswordView(APIView):
    """POST ``{current_password, new_password}``. Revokes every other session and returns new tokens."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "change_password"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        revoke_all_sessions(user)
        if is_staff_account(user):
            _audit(user, "auth.password_changed", user, {"email": user.email, "ip": client_ip(request)})
        tokens = issue_tokens(user)
        return Response({"detail": "Password changed", **tokens, "user": MeSerializer(user).data})


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
        user = User.objects.filter(pk=token.payload.get(jwt_settings.USER_ID_CLAIM)).first()
        if is_staff_account(user):
            _audit(user, "auth.logout", user, {"email": user.email, "ip": client_ip(request)})
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
        revoke_all_sessions(user)
        if is_staff_account(user):
            _audit(None, "admin.password_reset_via_email", user, {"email": user.email, "name": user.get_full_name()})
        return Response({"detail": "Password has been reset"})
