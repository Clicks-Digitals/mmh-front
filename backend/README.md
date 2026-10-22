# MMH Django backend

REST API for the MMH storefront and admin panel.

Repo: https://github.com/Yazan123-wj/mmh-backend

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_catalog   # development only — refused in production
python manage.py runserver 8000
```

## API

Base: `http://localhost:8000/api/v1/`

- Health: `/health/`, `/api/health/`, `/api/ready/`
- Auth: `/auth/register/`, `/auth/token/`, `/auth/token/refresh/`, `/auth/logout/`, `/auth/password-reset/`, `/auth/password-reset/confirm/`, `/auth/me/`
- Catalog: `/catalog/...`
- Checkout: `/checkout/orders/`, `/coupons/validate/`
- Orders: `/orders/mine/`, `/orders/:order_number/`
- Admin: `/admin/...` (JWT + RBAC)
- Supplier: `/suppliers/1epin/...` and `/admin/1epin/...`

## Environment

See `.env.example`. Key production flags:

- `DJANGO_ENV=production` (and `staging`) requires strong `SECRET_KEY`, `CODE_ENCRYPTION_KEY` (64 hex chars), DB password, CORS, `DEBUG=false`
- `ALLOW_DEMO_AUTO_PAYMENT` must be false in production
- `ONEEPIN_ALLOW_LIVE` remains false until payment go-live
- Managed Postgres often needs `POSTGRES_SSLMODE=require` (default in production)

Generate encryption key: `openssl rand -hex 32` — back it up; losing it makes stored codes undecryptable.

## Deploy (Railway)

The backend ships as a Docker image (`Dockerfile` + `scripts/entrypoint.sh`).

1. **Postgres**: add the Railway PostgreSQL plugin and map its variables to
   `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
   (set `POSTGRES_SSLMODE` to match the connection: `require` on the public proxy, `disable`/`prefer` on the private network).
2. **Web service** from this directory's `Dockerfile`. The entrypoint runs
   `migrate`, `createcachetable` (DB cache used by API throttling), `collectstatic`, then gunicorn on `$PORT`.
   Health check path: `/api/health/` (exempt from the HTTPS redirect). Add `healthcheck.railway.app` to `ALLOWED_HOSTS`.
3. **Volume** for uploaded images: mount a Railway volume at `/data/media` on the web service and set
   `MEDIA_ROOT=/data/media`. Media is served by Django at `/media/...` with long cache headers;
   `code_imports/` is never served.
4. **Jobs service** (cron): a second service from the same image with `RUN_MODE=jobs` and a cron schedule
   of `*/10 * * * *`. It runs `python manage.py run_scheduled_jobs` once and exits with its status code
   (no migrations, no web server). Give it the same database/env variables as the web service.

Required env (web and jobs):

- `DJANGO_ENV=production` (or `staging` — same hardening), `DEBUG=false`
- `SECRET_KEY` (or `DJANGO_SECRET_KEY`) — startup fails without it in staging/production
- `CODE_ENCRYPTION_KEY` — 64 hex chars (`openssl rand -hex 32`), required in staging/production; never rotate once codes exist
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`
- `POSTGRES_*`
- `SITE_URL` (storefront origin used in password-reset emails, default `https://www.mmhcard.com`)
- `MEDIA_ROOT=/data/media` (web service)
- Email: `EMAIL_HOST`, `EMAIL_PORT` (587), `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`/`EMAIL_USE_SSL`,
  `DEFAULT_FROM_EMAIL` — without `EMAIL_HOST` emails only go to the logs (a warning is logged at startup)
- PayPal: `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_CURRENCY`, `PAYPAL_FX_RATE`

Optional: `SENTRY_DSN`, `SUPPORT_EMAIL`, `DJANGO_ADMIN_ENABLED` (default off outside development),
`DRF_NUM_PROXIES` (default 1 when deployed), `THROTTLE_<SCOPE>_RATE` overrides, `WEB_CONCURRENCY`.
See `.env.example` for the full list.

Docker (any host):

```bash
docker build -t mmh-backend .
docker run -p 8000:8000 --env-file .env mmh-backend
docker run --env-file .env -e RUN_MODE=jobs mmh-backend   # one-shot scheduled jobs
```

Demo customer (dev seed): `demo@mmh.local` / `DemoCustomer1!`  
Supplier mode defaults to `mock`. Live 1Epin is locked.
