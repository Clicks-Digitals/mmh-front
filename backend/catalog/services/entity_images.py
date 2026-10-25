"""Upload / remove the single picture of a catalog or CMS entity (category, platform, home tile, logo...).

Reuses the product media pipeline (``save_upload``: magic-byte sniffing, 5 MB limit, extension
allow-list, Pillow decode + downscale, MEDIA_ROOT storage). The stored value is the MEDIA_URL path
(``/media/uploads/<uuid>.<ext>``); serializers turn it into an absolute URL with ``media_absolute_url``.
Files are never deleted here (other rows may share a path); ``report_orphan_media`` cleans up.
"""

from __future__ import annotations

from typing import Callable

from rest_framework import status
from rest_framework.response import Response

from audit.services import record_audit
from catalog.services.media import MediaUploadError, save_upload


def _save_field(instance, field: str) -> None:
    fields = [field]
    if any(f.name == "updated_at" for f in instance._meta.concrete_fields):
        fields.append("updated_at")
    instance.save(update_fields=fields)


def entity_image_response(
    request,
    instance,
    *,
    field: str = "image",
    audit_prefix: str,
    entity_type: str,
    label: str,
    serialize: Callable[[object], dict],
    extra_meta: dict | None = None,
) -> Response:
    """POST (multipart ``file`` or ``image``) stores the picture; DELETE clears it.

    Responds with ``serialize(instance)`` (200) or ``{"detail": ...}`` (400) on invalid uploads.
    Audited as ``<audit_prefix>.image_uploaded`` / ``<audit_prefix>.image_removed``.
    """
    meta = {"field": field, "label": label[:120], **(extra_meta or {})}
    if request.method == "DELETE":
        previous = getattr(instance, field) or ""
        setattr(instance, field, "")
        _save_field(instance, field)
        record_audit(
            request.user,
            f"{audit_prefix}.image_removed",
            entity_type=entity_type,
            entity_id=instance.pk,
            meta={**meta, "previous": previous[:200]},
        )
        return Response(serialize(instance))

    upload = request.FILES.get("file") or request.FILES.get("image")
    if not upload:
        return Response({"detail": "Choose an image file to upload.", "code": "file_required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        path, url, mime = save_upload(upload, getattr(upload, "name", "") or "")
    except MediaUploadError as exc:
        return Response({"detail": exc.message, "code": "invalid_image"}, status=exc.status)
    previous = getattr(instance, field) or ""
    setattr(instance, field, url)
    _save_field(instance, field)
    record_audit(
        request.user,
        f"{audit_prefix}.image_uploaded",
        entity_type=entity_type,
        entity_id=instance.pk,
        meta={**meta, "path": path, "mime_type": mime, "previous": previous[:200]},
    )
    return Response(serialize(instance))
