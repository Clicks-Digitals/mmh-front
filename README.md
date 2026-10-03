# MMH

Monorepo for the MMH digital storefront and commerce API.

```text
Browser → Next.js (frontend :3001) → Django REST (backend :8000) → PostgreSQL
```

**Prisma is not part of the active architecture.** The frontend never talks to PostgreSQL.

## Status

| Track | Status |
| --- | --- |
| Production infrastructure | Prepared — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Commerce go-live | **BLOCKED** — payment integration owned by external developer |

Payment handoff: [docs/PAYMENT_INTEGRATION_HANDOFF.md](docs/PAYMENT_INTEGRATION_HANDOFF.md)  
OneEpin live purchasing remains **locked** until payment + fulfillment go-live.

## Layout

```text
mmh-front/
├── frontend/   # Next.js UI only
├── backend/    # Django + DRF + SimpleJWT
├── docs/
└── docker-compose.yml
```

## Ports

| Service | Port |
| --- | --- |
| Frontend | 3001 |
| Django API | 8000 |
| PostgreSQL | 5432 |

## Run locally

### 1. PostgreSQL

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_catalog
python manage.py runserver 8000
```

API base: `http://localhost:8000/api/v1/`  
Health: `http://localhost:8000/api/health/`

Demo customer (development seed): `demo@mmh.local` / `DemoCustomer1!`  
Checkout creates **pending** orders by default (no payment, no code delivery). Demo auto-pay is opt-in via `ALLOW_DEMO_AUTO_PAYMENT=true` in development only.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Required: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1`

## Docs

| Doc | Purpose |
| --- | --- |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deploy units & steps |
| [PAYMENT_INTEGRATION_HANDOFF.md](docs/PAYMENT_INTEGRATION_HANDOFF.md) | Payment developer contract |
| [BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | Postgres + encryption key backup |
| [MEDIA_STORAGE.md](docs/MEDIA_STORAGE.md) | Media persistence |
| [STATIC_FALLBACK.md](docs/STATIC_FALLBACK.md) | Static catalog fallback policy |
| [CODE_INVENTORY.md](docs/CODE_INVENTORY.md) | Digital code inventory |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview |

## Authentication

1. Storefront signs in via NextAuth credentials  
2. NextAuth calls Django `POST /auth/token/` (SimpleJWT)  
3. Access token lives on the NextAuth session for API calls  

Admin REST: `/api/v1/admin/` (JWT + RBAC).

## Money & codes

Integer **fils** only (1 JOD = 1000 fils). Digital codes are AES-GCM encrypted; reveal is permission-gated and audited. Protect `CODE_ENCRYPTION_KEY` independently of DB backups.
