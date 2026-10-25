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
- Auth: `/auth/register/`, `/auth/token/`, `/auth/token/refresh/`, `/auth/logout/`, `/auth/password-reset/`, `/auth/password-reset/confirm/`, `/auth/me/` (GET, PATCH name/phone), `/auth/change-password/`
- Catalog: `/catalog/...`
- Checkout: `/checkout/orders/`, `/coupons/validate/`
- Orders: `/orders/mine/`, `/orders/:order_number/`
- Admin: `/admin/...` (JWT + RBAC)
- Supplier: `/suppliers/1epin/...` and `/admin/1epin/...`

## Environment

See `.env.example`. Key production flags:

- `DJANGO_ENV=production` (and `staging`) requires strong `SECRET_KEY`, `CODE_ENCRYPTION_KEY` (64 hex chars), DB password, CORS, `DEBUG=false`
- `ALLOW_DEMO_AUTO_PAYMENT` must be false in production
- 1Epin live purchasing needs `SUPPLIER_MODE=live` **and** `ONEEPIN_ALLOW_LIVE=true` (see "1Epin integration")

### Auth & stock rules

- Login: 401 `invalid_credentials` (unknown email or wrong password), 403 `account_disabled` (only after a correct password), 429 when throttled.
- Every JWT carries `tv` = `User.token_version`. Password change/reset, disabling an account and admin role changes bump it, so existing access tokens stop working at once (401). After a role change the refresh token still works and re-issues an access token with the new permissions; a password change or disable blacklists refresh tokens too.
- `is_superuser` mirrors the SUPER_ADMIN role (role changes keep it in sync; migration `accounts.0005` repairs existing rows).
- Passwords must contain at least 5 different characters (on top of Django's validators).
- A 1Epin mapping counts as stock only when live purchasing really works (`SUPPLIER_MODE=live`, `ONEEPIN_ALLOW_LIVE=true`, credentials), the mapping has `auto_buy`, and the mapped 1Epin product is active in a catalog sync < 48 h old. In test/mock mode it counts only with `ONEEPIN_TEST_COUNTS_AS_STOCK=true`.
- Low stock everywhere means `available codes <= SiteSettings.low_stock_threshold` (published CODE variants only).
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
Supplier mode defaults to `mock` (simulated 1Epin).

## 1Epin integration

1Epin (https://www.1epin.com, API doc v1.0.5) supplies e-pin codes and game top-ups. When an order is
paid, items our own stock cannot cover (or every unit when the mapping has `prefer_supplier`) are bought
from 1Epin automatically for product options that are **mapped** to a 1Epin product.

### Modes (`SUPPLIER_MODE`)

| Mode | Base URL | Buys? |
|------|----------|-------|
| `mock` (default) | none - simulated in-process | fake `MOCK-...` PINs, **development only** (`ONEEPIN_MOCK_FULFILLMENT`, forced off in staging/production) |
| `test` | `https://www.1epin.com/api/test/` | 1Epin test wallet (public accounts `test@1epin.com` / `test_usd@1epin.com`, password `test1234`) |
| `live` | `https://www.1epin.com/api/live/` | real money; needs `ONEEPIN_ALLOW_LIVE=true` as well |

The mock catalog has two scenario products: `9001` (top-up that always fails with `wrong_player_id`)
and `9002` (e-pin that stays "Processing" for 60 s). A top-up with player id `000000` also fails.

### Setup

1. **Static outgoing IP.** 1Epin only accepts API calls from IPs registered on its API settings page;
   anything else gets ResultCode `02 Unauthorized Ip Address` (even the public test accounts). Railway has
   no static egress IP by default: enable a static outbound IP for the service, or set `ONEEPIN_HTTP_PROXY`
   to a static-IP proxy (`http://user:pass@host:port`; used for every 1Epin request and the IP lookup).
2. Open the admin 1Epin page (`GET /api/v1/admin/1epin/status/?refresh_ip=1`): `outgoing_ip` is the
   address 1Epin will see. Register it on **https://www.1epin.com/api-ayarlari** (API Settings).
3. Generate `ONEEPIN_CALLBACK_TOKEN` (`openssl rand -hex 24`) and register the `callback_url` shown on the
   status page: `<PUBLIC_API_URL>/api/v1/suppliers/1epin/callback/<ONEEPIN_CALLBACK_TOKEN>/`.
   1Epin posts `{OrderNumber, OrderStatusCode, OrderStatusMessage, PinCodes, OrderAmount}`; we store it
   (PINs masked), confirm it with `checkOrder` (callbacks are unsigned) and reply plain `OK`.
4. Set `ONEEPIN_EMAIL` / `ONEEPIN_PASSWORD` (the 1epin.com account) on the web **and** jobs services.
5. `SUPPLIER_MODE=test`, deploy, "Test connection" / "Refresh balance", then "Sync catalog".
6. Map product options to 1Epin products (1Epin page or the product's Supplier tab). The mapping shows
   cost in JOD (`price x quantity_per_unit x ONEEPIN_FX_TO_JOD`), sale price, margin and warnings.
7. The jobs service (`run_scheduled_jobs`, every 10 min) reconciles open supplier orders, retries the
   23:45-00:00 service window, syncs the catalog once a day and refreshes the balance hourly.

### How purchasing works

* One supplier order per order item per attempt; `orderNumber = MMH-<order_number>-<item_id>-<attempt>`.
* It runs **after** the payment transaction commits, never inside it. The capture request places the
  order and does one immediate `checkOrder`; anything still processing completes through the callback or
  the scheduled reconcile (orders idle > 2 minutes; > 2 h -> manual review + alert).
* Network errors/timeouts -> `UNKNOWN`, then confirmed with `checkOrder`; only `08 Order Not Found`
  allows re-sending, always with the **same** orderNumber (`07` = already placed -> checked). Staff
  "Retry with supplier" (new attempt) is only possible after a definitive failure.
* `1 Completed` -> PINs stored encrypted as codes (source ONEEPIN; duplicates are never delivered and
  raise an alert; surplus PINs go to stock) / top-up marked delivered ("Delivered via 1Epin").
  `2 failed` -> FAILED + alert; `04` -> manual review + low-balance alert; `02/03` -> config alert;
  `01/05/06/09/11-17` -> manual review with the readable reason; `10` -> retried after the window.
* Money guard: no auto-buy when the JOD cost exceeds `max_cost_fils` (per unit) or the sale price (unless
  `allow_loss`). Staff "Buy from supplier now" overrides it after confirming the shown cost.
* Credentials are never logged; API logs keep method, ResultCode, message, duration and orderNumber.

### Environment

`SUPPLIER_MODE` (mock), `ONEEPIN_ALLOW_LIVE` (false), `ONEEPIN_EMAIL`, `ONEEPIN_PASSWORD`,
`ONEEPIN_CALLBACK_TOKEN`, `ONEEPIN_RECONCILE_TOKEN`, `PUBLIC_API_URL`
(https://backend-production-8e0e1e.up.railway.app), `ONEEPIN_HTTP_PROXY`, `ONEEPIN_REQUEST_TIMEOUT_MS`
(15000), `ONEEPIN_CURRENCY` (USD), `ONEEPIN_FX_TO_JOD` (0.709), `ONEEPIN_LOW_BALANCE` (20),
`ONEEPIN_TEST_COUNTS_AS_STOCK` (false), `ONEEPIN_MOCK_FULFILLMENT` (true in development only),
`ONEEPIN_INLINE_FULFILLMENT` (true), `ONEEPIN_IP_LOOKUP_URL` (ipify). See `.env.example`.

### Go-live checklist

1. Static outgoing IP (or `ONEEPIN_HTTP_PROXY`) registered on https://www.1epin.com/api-ayarlari; the status page shows it.
2. Callback URL with a strong `ONEEPIN_CALLBACK_TOKEN` registered on the same page.
3. Full rehearsal in `SUPPLIER_MODE=test` (optionally `ONEEPIN_TEST_COUNTS_AS_STOCK=true` on staging):
   balance, catalog sync, one e-pin and one top-up order end to end, callback received.
4. Live credentials on web **and** jobs services; the jobs cron runs every 10 minutes.
5. `SUPPLIER_MODE=live` + `ONEEPIN_ALLOW_LIVE=true`; `python manage.py check` shows no `suppliers.W00x`.
6. Sync the live catalog (live product ids may differ from test), re-check every mapping's cost/margin,
   fund the wallet above `ONEEPIN_LOW_BALANCE`, then place one small real order.
