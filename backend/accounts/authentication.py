from __future__ import annotations

from django.db.models import F
from django.utils.translation import gettext_lazy as _
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.tokens import RefreshToken

# JWT claim carrying ``User.token_version``. Tokens minted before the claim existed have
# no ``tv`` and are treated as version 0 (valid until the user's version is bumped).
TOKEN_VERSION_CLAIM = "tv"


def user_can_authenticate(user) -> bool:
    """SIMPLE_JWT USER_AUTHENTICATION_RULE: active and not disabled by an admin."""
    return bool(user is not None and user.is_active and not getattr(user, "disabled", False))


def token_version_of(token) -> int:
    try:
        return int(token.get(TOKEN_VERSION_CLAIM, 0) or 0)
    except (TypeError, ValueError):
        return -1


class VersionedRefreshToken(RefreshToken):
    """Refresh token whose (copied-to-access) claims include the user's ``token_version``."""

    @classmethod
    def for_user(cls, user):
        token = super().for_user(user)
        token[TOKEN_VERSION_CLAIM] = int(getattr(user, "token_version", 0) or 0)
        return token


def issue_tokens(user) -> dict:
    """Fresh ``{"refresh", "access"}`` pair for ``user`` (carries the current token_version)."""
    refresh = VersionedRefreshToken.for_user(user)
    return {"refresh": str(refresh), "access": str(refresh.access_token)}


class ActiveUserJWTAuthentication(JWTAuthentication):
    """JWT auth that rejects disabled/inactive users and stale ``token_version`` on every request."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not user_can_authenticate(user):
            raise AuthenticationFailed(_("User account is disabled"), code="user_disabled")
        if token_version_of(validated_token) != int(getattr(user, "token_version", 0) or 0):
            raise AuthenticationFailed(_("Session expired. Please sign in again."), code="token_revoked")
        return user


def bump_token_version(user) -> int:
    """Invalidate every outstanding access token of ``user``. Returns the new version."""
    from accounts.models import User

    User.objects.filter(pk=user.pk).update(token_version=F("token_version") + 1)
    user.token_version = User.objects.filter(pk=user.pk).values_list("token_version", flat=True).first() or 0
    return user.token_version


def revoke_refresh_tokens(user) -> int:
    """Blacklist every outstanding refresh token for ``user``. Returns the number blacklisted."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    count = 0
    for token in OutstandingToken.objects.filter(user=user).exclude(blacklistedtoken__isnull=False):
        BlacklistedToken.objects.get_or_create(token=token)
        count += 1
    return count


def revoke_all_sessions(user) -> None:
    """Kill access tokens (version bump) and refresh tokens (blacklist)."""
    bump_token_version(user)
    revoke_refresh_tokens(user)
