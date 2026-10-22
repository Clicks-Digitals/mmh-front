from __future__ import annotations

from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import ScopedRateThrottle


class CommerceScopedRateThrottle(ScopedRateThrottle):
    """ScopedRateThrottle that is a no-op when REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    has no rate for the view's ``throttle_scope`` (instead of raising ImproperlyConfigured).

    Scopes used by commerce: checkout, coupon, order_lookup, code_reveal, paypal.
    """

    def get_rate(self):
        try:
            return super().get_rate()
        except ImproperlyConfigured:
            return None


def commerce_throttle_classes() -> list[type]:
    """Global DEFAULT_THROTTLE_CLASSES (anon/user limits) with any plain ScopedRateThrottle
    replaced by CommerceScopedRateThrottle, so the scope is enforced explicitly and counted once."""
    from rest_framework.settings import api_settings

    classes = [
        cls
        for cls in api_settings.DEFAULT_THROTTLE_CLASSES
        if not (isinstance(cls, type) and issubclass(cls, ScopedRateThrottle))
    ]
    classes.append(CommerceScopedRateThrottle)
    return classes


COMMERCE_THROTTLE_CLASSES = commerce_throttle_classes()
