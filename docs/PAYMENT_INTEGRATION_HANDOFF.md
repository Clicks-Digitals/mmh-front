# Payment Integration Handoff

**Owner:** external payment developer  
**Status:** payment provider integration is **OUT OF SCOPE** for the current MMH team phase.  
**Commerce go-live:** **BLOCKED** until this work is complete and verified.

This document describes the **actual** MMH architecture as of production-prep. Do not invent parallel order stores or mark orders paid from the browser.

---

## Required production flow (target)

```text
Customer checkout
  → Django creates Order (payment_status=PENDING)
  → Django creates Payment (status=PENDING)
  → Frontend / provider payment step
  → Payment provider
  → Provider callback / webhook (server-side)
  → Django verifies signature, amount, currency, order
  → commerce.services.payment.mark_payment_verified(...)
  → Payment PAID + Order payment_status PAID
  → Coupon used_count incremented (only on first verify)
  → commerce.services.fulfillment.fulfill_order(...)
  → Local DigitalCode inventory OR supplier fulfillment (OneEpin later)
  → Order fulfillment COMPLETED
```

Do **not** fulfill before server-side verification.  
Do **not** trust client redirects as proof of payment.

---

## Current models

Source: `backend/commerce/models.py`

### Order

| Field | Notes |
| --- | --- |
| `order_number` | Unique public id |
| `user` | Optional FK to accounts user |
| `email`, `full_name`, `phone`, `notes` | Customer snapshot |
| `coupon` | Optional FK |
| `subtotal_fils`, `discount_fils`, `total_fils` | Integer fils only (1 JOD = 1000 fils) |
| `currency` | Default `JOD` |
| `payment_status` | See statuses below |
| `fulfillment_status` | See statuses below |
| `idempotency_key` | Indexed; checkout dedupes on this |
| `region_confirmed`, `refund_confirmed` | Checkout acknowledgements |

### OrderItem

Line items with product/variant FKs, quantity, unit/line fils, customer_fields JSON, delivery metadata.

### Payment

| Field | Notes |
| --- | --- |
| `order` | FK |
| `provider` | e.g. `pending`, `placeholder` (demo), future PSP name |
| `status` | Same enum as order payment_status |
| `amount_fils` | Must match order total on verify |
| `external_ref` | Provider reference (indexed) |
| `raw` | JSON metadata — **never** store card data or full secret payloads |

### DigitalCode

Encrypted inventory / delivery codes (AES-GCM). Statuses: `AVAILABLE`, `RESERVED`, `DELIVERED`, `UNAVAILABLE`.

---

## Statuses

### PaymentStatus

`PENDING` → `AUTHORIZED` → `PAID` → (`REFUNDED` | `PARTIALLY_REFUNDED`)  
Also: `FAILED`, `CANCELLED`

Allowed transitions are enforced in `commerce/services/orders.py` (`PAYMENT_TRANSITIONS`).

### FulfillmentStatus

`NOT_STARTED` → `QUEUED` → `PROCESSING` → `COMPLETED`  
Also: `FAILED`, `MANUAL_REVIEW`, `CANCELLED`

`COMPLETED` and `CANCELLED` are terminal.

### Mapping to business language

| Concept | Model fields |
| --- | --- |
| Pending payment | `payment_status=PENDING`, fulfillment `NOT_STARTED` |
| Paid | `payment_status=PAID` |
| Processing | `fulfillment_status=PROCESSING` (or `QUEUED`) |
| Fulfilled | `fulfillment_status=COMPLETED` |
| Failed | payment `FAILED` and/or fulfillment `FAILED` |
| Cancelled | payment and/or fulfillment `CANCELLED` |

---

## Current checkout flow (what exists today)

1. Frontend server action `frontend/src/server/actions/checkout.ts` → Django `POST /api/v1/checkout/orders/`.
2. `commerce/services/checkout.py` → `create_storefront_order`:
   - Validates cart against **live** Product/Variant rows (Django ORM).
   - Creates `Order` with `payment_status=PENDING`, `fulfillment_status=NOT_STARTED`.
   - Creates `Payment` with `status=PENDING`.
   - **Does not** issue codes yet.
3. If `ALLOW_DEMO_AUTO_PAYMENT=true` (development opt-in only; default is false):
   - Calls `commerce.services.payment.apply_demo_auto_payment` → `mark_payment_verified` → `fulfill_order`.
   - Issues `CHECKOUT_DEMO` encrypted codes.
4. If demo auto-pay is **false** (required for production):
   - Order remains pending payment.
   - **No codes**, **coupon `used_count` not incremented** until `mark_payment_verified`.

### Demo payment behavior — DEVELOPMENT / DEMO ONLY

`ALLOW_DEMO_AUTO_PAYMENT`:

- Defaults `true` only when `DJANGO_ENV=development`.
- Production **raises at startup** if set true.
- Runtime also refuses demo auto-pay when `IS_PRODUCTION`.

**When integrating real payment, remove reliance on demo auto-pay entirely.** Replace with provider create + webhook → `mark_payment_verified`.

---

## Authoritative service boundaries

| Concern | Module | Function |
| --- | --- | --- |
| Create order + pending payment | `commerce/services/checkout.py` | `create_storefront_order` |
| Mark payment verified (webhook success) | `commerce/services/payment.py` | `mark_payment_verified` |
| Fulfill after paid | `commerce/services/fulfillment.py` | `fulfill_order` |
| Admin status transitions | `commerce/services/orders.py` | `transition_order` |

**Do not** scatter PAID / fulfill logic across DRF views, serializers, or React.

Suggested future HTTP surface (adapt to provider; keep under `/api/v1/`):

- `POST /api/v1/payments/create/`
- `POST /api/v1/payments/webhook/<provider>/`
- `GET /api/v1/payments/<reference>/status/`

Do not invent fake endpoints until the provider contract is known.

---

## Idempotency (mandatory)

Webhooks can be delivered multiple times.

`mark_payment_verified` is designed to be idempotent:

- If `Payment.status` is already `PAID`, it does **not** increment coupon again.
- It re-enters `fulfill_order`, which no-ops when `fulfillment_status=COMPLETED` and does not duplicate demo codes when codes already exist.

You must still ensure:

- Provider `external_ref` uniqueness (or DB unique constraint) where appropriate.
- Amount/currency/order checks before calling verify.
- No second OneEpin purchase / second inventory assignment on replay.

Order checkout already dedupes via `idempotency_key`.

---

## Coupon usage

- Validation at checkout: active, date window, `max_uses` vs `used_count`.
- **`used_count` increments only inside `mark_payment_verified`** when transitioning unpaid → PAID.
- Pending/failed unpaid orders do **not** permanently consume coupon quota (production semantics).

---

## Fulfillment contract (payment → codes)

```text
mark_payment_verified
  → Order payment_status PAID
  → fulfill_order
       DEMO mode: issue CHECKOUT_DEMO codes → COMPLETED
       Production (current): advance to PROCESSING; inventory/supplier assignment TBD
```

### Future local inventory

Payment verified → reserve/assign `DigitalCode` with `status=AVAILABLE` → encrypt already stored → mark `DELIVERED` → order COMPLETED.

### Future supplier-backed

Payment verified → supplier service purchase → receive code → encrypt/store/audit → deliver.  
**OneEpin LIVE remains locked** until payment + fulfillment idempotency + explicit go-live.

Do not call OneEpin from Next.js.

---

## Exact files to inspect

| File | Responsibility |
| --- | --- |
| `backend/commerce/models.py` | Order, Payment, OrderItem, DigitalCode, statuses |
| `backend/commerce/services/checkout.py` | Storefront order creation |
| `backend/commerce/services/payment.py` | **Verify payment entry point** |
| `backend/commerce/services/fulfillment.py` | **Fulfillment entry point** |
| `backend/commerce/services/orders.py` | Status transition rules + audit |
| `backend/commerce/views.py` | HTTP: checkout + admin order APIs |
| `backend/commerce/crypto.py` | AES-GCM encrypt/decrypt; protect `CODE_ENCRYPTION_KEY` |
| `backend/config/settings.py` | `ALLOW_DEMO_AUTO_PAYMENT`, OneEpin locks, JWT, CORS |
| `backend/suppliers/provider.py` | Supplier modes; live lock |
| `frontend/src/server/actions/checkout.ts` | Storefront server action → Django only |
| `frontend/src/lib/api/orders.ts` | Client API helpers |

---

## Do-not-break list

1. Do not bypass the Django `Order` model.
2. Do not mark orders paid from frontend-only responses.
3. Do not trust client payment-success redirects.
4. Do not fulfill before provider **server-side** verification.
5. Do not expose provider secrets to Next.js browser bundles (`NEXT_PUBLIC_*`).
6. Do not call OneEpin from the frontend.
7. Do not issue / assign the same digital code twice.
8. Do not change integer **fils** representation.
9. Do not log PANs, tokens, raw provider secrets, or plaintext codes.
10. Do not remove JWT + RBAC admin security.

---

## Webhook future requirements (document only — do not skip)

- Provider signature verification
- Idempotency
- Payment reference uniqueness
- Amount verification (`payment.amount_fils == order.total_fils`)
- Currency verification
- Order verification
- Replay protection where provider supports it
- Atomic status update
- Fulfillment trigger only after valid verification (`mark_payment_verified`)
- Failure logging without sensitive payloads

---

## SELECT field options (known limitation)

Product `SELECT` field definitions currently store labels without a dedicated options model. Leave as-is unless storefront requires a fix; treat as a future enhancement.

---

## OneEpin unlock prerequisites

Live purchasing must stay locked until **all** of:

1. Real payment integration complete
2. Payment webhook verified end-to-end
3. Fulfillment idempotency tested
4. Supplier test credentials validated
5. Explicit go-live decision (`ONEEPIN_ALLOW_LIVE` + ops approval)

Until then: `ONEEPIN_ALLOW_LIVE=false`, `SUPPLIER_MODE=mock|test`.
