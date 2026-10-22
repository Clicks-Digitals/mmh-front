"""Serve uploaded media (product images, banners) from MEDIA_ROOT in every environment.

Private sub-trees (code import spreadsheets) are never served.
"""

from __future__ import annotations

import posixpath

from django.conf import settings
from django.http import Http404
from django.utils.cache import patch_cache_control
from django.views.static import serve

# Paths under MEDIA_ROOT that must never be reachable over HTTP.
PRIVATE_MEDIA_PREFIXES = ("code_imports/",)


def _is_private(path: str) -> bool:
    normalized = posixpath.normpath(path.replace("\\", "/")).lstrip("/")
    lowered = normalized.lower()
    if lowered == ".." or lowered.startswith("../"):
        return True  # traversal outside MEDIA_ROOT
    return any(lowered == p.rstrip("/") or lowered.startswith(p) for p in PRIVATE_MEDIA_PREFIXES)


def serve_media(request, path: str):
    if _is_private(path):
        raise Http404("Not found")
    response = serve(request, path, document_root=settings.MEDIA_ROOT, show_indexes=False)
    patch_cache_control(response, public=True, max_age=settings.MEDIA_CACHE_SECONDS, immutable=True)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cross-Origin-Resource-Policy"] = "cross-origin"
    return response
