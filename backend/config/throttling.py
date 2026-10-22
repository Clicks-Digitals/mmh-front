from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import AnonRateThrottle


class AnonWriteRateThrottle(AnonRateThrottle):
    """Per-IP limit for unauthenticated writes (rate: ``anon``)."""

    scope = "anon"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)


class AnonReadRateThrottle(AnonRateThrottle):
    """Per-IP limit for unauthenticated reads (rate: ``anon_read``; ``None`` disables it)."""

    scope = "anon_read"

    def allow_request(self, request, view):
        if request.method not in SAFE_METHODS:
            return True
        return super().allow_request(request, view)
