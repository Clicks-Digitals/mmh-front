from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed


def user_can_authenticate(user) -> bool:
    """SIMPLE_JWT USER_AUTHENTICATION_RULE: active and not disabled by an admin."""
    return bool(user is not None and user.is_active and not getattr(user, "disabled", False))


class ActiveUserJWTAuthentication(JWTAuthentication):
    """JWT auth that rejects disabled/inactive users on every request (not just at login)."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not user_can_authenticate(user):
            raise AuthenticationFailed(_("User account is disabled"), code="user_disabled")
        return user


def revoke_refresh_tokens(user) -> int:
    """Blacklist every outstanding refresh token for ``user``. Returns the number blacklisted."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    count = 0
    for token in OutstandingToken.objects.filter(user=user).exclude(blacklistedtoken__isnull=False):
        BlacklistedToken.objects.get_or_create(token=token)
        count += 1
    return count
