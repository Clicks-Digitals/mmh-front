"""Server-side PayPal Orders v2 client. All PayPal HTTP goes through here."""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from django.conf import settings

logger = logging.getLogger("commerce.paypal")

SANDBOX_API = "https://api-m.sandbox.paypal.com"
LIVE_API = "https://api-m.paypal.com"
SANDBOX_SDK = "https://www.sandbox.paypal.com/web-sdk/v6/core"
LIVE_SDK = "https://www.paypal.com/web-sdk/v6/core"

_token_lock = threading.Lock()
_token_cache: dict[str, tuple[str, float]] = {}


class PayPalApiError(Exception):
    def __init__(
        self,
        message: str,
        *,
        http_status: int,
        name: str = "",
        issue: str = "",
        debug_id: str = "",
    ):
        super().__init__(message)
        self.message = message
        self.http_status = http_status
        self.name = name
        self.issue = issue
        self.debug_id = debug_id

    def __str__(self) -> str:
        return self.message


def api_base(env: str | None = None) -> str:
    current = env if env is not None else settings.PAYPAL_ENV
    return LIVE_API if current == "live" else SANDBOX_API


def sdk_url(env: str | None = None) -> str:
    current = env if env is not None else settings.PAYPAL_ENV
    return LIVE_SDK if current == "live" else SANDBOX_SDK


def clear_token_cache() -> None:
    with _token_lock:
        _token_cache.clear()


class PayPalClient:
    def __init__(self) -> None:
        self.base = api_base()
        self.client_id = settings.PAYPAL_CLIENT_ID
        self.secret = settings.PAYPAL_CLIENT_SECRET
        self.timeout = float(settings.PAYPAL_TIMEOUT_SECONDS)

    def get_access_token(self) -> str:
        cache_key = f"{self.base}:{self.client_id}"
        now = time.time()
        with _token_lock:
            cached = _token_cache.get(cache_key)
            if cached and cached[1] > now + 60:
                return cached[0]
        _status, body = self._request(
            "POST",
            "/v1/oauth2/token",
            form={"grant_type": "client_credentials"},
            basic=True,
        )
        token = str(body.get("access_token") or "")
        if not token:
            raise PayPalApiError("PayPal did not return an access token", http_status=502)
        expires_in = int(body.get("expires_in") or 300)
        with _token_lock:
            _token_cache[cache_key] = (token, time.time() + expires_in)
        return token

    def create_order(
        self,
        *,
        value: str,
        currency: str,
        order_number: str,
        invoice_id: str,
        request_id: str,
    ) -> dict[str, Any]:
        payload = {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": order_number[:256],
                    "custom_id": order_number[:127],
                    "invoice_id": invoice_id[:127],
                    "description": f"MMH order {order_number}"[:127],
                    "amount": {"currency_code": currency, "value": value},
                }
            ],
            "application_context": {
                "brand_name": settings.PAYPAL_BRAND_NAME[:127],
                "shipping_preference": "NO_SHIPPING",
                "user_action": "PAY_NOW",
            },
        }
        _status, body = self._authed(
            "POST",
            "/v2/checkout/orders",
            json_body=payload,
            extra_headers={
                "PayPal-Request-Id": request_id,
                "Prefer": "return=representation",
            },
        )
        return body

    def get_order(self, paypal_order_id: str) -> dict[str, Any]:
        _status, body = self._authed("GET", f"/v2/checkout/orders/{paypal_order_id}")
        return body

    def capture_order(self, paypal_order_id: str, *, request_id: str) -> dict[str, Any]:
        _status, body = self._authed(
            "POST",
            f"/v2/checkout/orders/{paypal_order_id}/capture",
            json_body={},
            extra_headers={
                "PayPal-Request-Id": request_id,
                "Prefer": "return=representation",
            },
        )
        return body

    def refund_capture(
        self,
        capture_id: str,
        *,
        request_id: str,
        value: str | None = None,
        currency: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if value is not None:
            payload = {"amount": {"value": value, "currency_code": currency}}
        _status, body = self._authed(
            "POST",
            f"/v2/payments/captures/{capture_id}/refund",
            json_body=payload,
            extra_headers={
                "PayPal-Request-Id": request_id,
                "Prefer": "return=representation",
            },
        )
        return body

    def verify_webhook(self, *, headers: dict[str, str], event: dict[str, Any]) -> bool:
        payload = {
            "auth_algo": headers.get("auth_algo", ""),
            "cert_url": headers.get("cert_url", ""),
            "transmission_id": headers.get("transmission_id", ""),
            "transmission_sig": headers.get("transmission_sig", ""),
            "transmission_time": headers.get("transmission_time", ""),
            "webhook_id": settings.PAYPAL_WEBHOOK_ID,
            "webhook_event": event,
        }
        _status, body = self._authed(
            "POST",
            "/v1/notifications/verify-webhook-signature",
            json_body=payload,
        )
        return str(body.get("verification_status") or "").upper() == "SUCCESS"

    def _authed(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        extra_headers: dict[str, str] | None = None,
        retry: bool = True,
    ) -> tuple[int, dict[str, Any]]:
        token = self.get_access_token()
        try:
            return self._request(
                method,
                path,
                json_body=json_body,
                headers=extra_headers,
                bearer=token,
            )
        except PayPalApiError as exc:
            if exc.http_status == 401 and retry:
                cache_key = f"{self.base}:{self.client_id}"
                with _token_lock:
                    _token_cache.pop(cache_key, None)
                return self._authed(
                    method,
                    path,
                    json_body=json_body,
                    extra_headers=extra_headers,
                    retry=False,
                )
            raise

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        form: dict | None = None,
        headers: dict[str, str] | None = None,
        bearer: str = "",
        basic: bool = False,
    ) -> tuple[int, dict[str, Any]]:
        data: bytes | None = None
        hdrs = {
            "Accept": "application/json",
            "User-Agent": "MMH-PayPal/1.0",
        }
        if json_body is not None:
            data = json.dumps(json_body).encode()
            hdrs["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        if basic:
            raw = base64.b64encode(f"{self.client_id}:{self.secret}".encode()).decode()
            hdrs["Authorization"] = f"Basic {raw}"
        elif bearer:
            hdrs["Authorization"] = f"Bearer {bearer}"
        if headers:
            hdrs.update(headers)
        request = urllib.request.Request(self.base + path, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw_body = response.read().decode()
                parsed = json.loads(raw_body) if raw_body else {}
                return response.status, parsed
        except urllib.error.HTTPError as exc:
            raw_body = exc.read().decode()
            try:
                parsed = json.loads(raw_body) if raw_body else {}
            except json.JSONDecodeError:
                parsed = {}
            details = parsed.get("details") if isinstance(parsed, dict) else None
            issue = ""
            if isinstance(details, list) and details:
                issue = str(details[0].get("issue") or "")
            logger.info(
                "PayPal HTTP %s %s -> %s issue=%s debug_id=%s",
                method,
                path,
                exc.code,
                issue,
                parsed.get("debug_id") if isinstance(parsed, dict) else "",
            )
            raise PayPalApiError(
                str(parsed.get("message") or f"PayPal request failed ({exc.code})")
                if isinstance(parsed, dict)
                else f"PayPal request failed ({exc.code})",
                http_status=exc.code,
                name=str(parsed.get("name") or "") if isinstance(parsed, dict) else "",
                issue=issue,
                debug_id=str(parsed.get("debug_id") or "") if isinstance(parsed, dict) else "",
            ) from exc
        except urllib.error.URLError as exc:
            logger.warning("PayPal network error %s %s", method, path)
            raise PayPalApiError("PayPal is unreachable", http_status=502) from exc
