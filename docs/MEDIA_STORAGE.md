# Media storage

## Development

Django `FileSystemStorage` under `backend/media/` (`MEDIA_ROOT`).  
Served when `DEBUG=true` via Django static media URLs (`/media/...`).

Frontend resolves relative media paths using the API origin (`frontend/src/lib/media.ts`) — no hardcoded production localhost.

## Production

Platforms with **ephemeral filesystems** (many container hosts) will **lose uploads** on restart if media is only local.

Current setup: a Railway **persistent volume** mounted at `/data/media` with `MEDIA_ROOT=/data/media`. Django serves `/media/...` in every environment (`config/media.py`, long cache headers); `code_imports/` is never served. For multi-instance scale, move to S3/R2 via django-storages.

WhiteNoise serves **Django static** files (`collectstatic`), not user media. Keep that boundary clear.

Next.js hosts its own `.next` static assets separately.

## Image URLs

- Prefer absolute URLs returned by the API, or paths starting with `/media/` resolved against the API host.
- Configure `NEXT_PUBLIC_API_URL` so `next.config.ts` remotePatterns allow `/media/**` from that host.

## Orphans

Report unreferenced local files:

```bash
python manage.py report_orphan_media
# optional destructive: python manage.py report_orphan_media --delete
```

Dry-run is the default behavior without `--delete`.
