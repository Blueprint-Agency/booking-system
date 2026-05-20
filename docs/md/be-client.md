# Backend — Client (`fe-client`)

The client-side backend surface. Implements the `/me/*` scope of the client app plus the unauthenticated `/public/*` reads used by the marketing pages and registration flow. Reads from `fe-client-features.md` for **behavior**; this doc maps that behavior onto routes, services, and database tables defined in `backend-architecture.md`.

- Spine: `backend-architecture.md` (stack, folder structure, full DB schema, integrations, jobs, shared cross-cutting).
- Behavior source of truth: `fe-client-features.md`.
- Sister doc: `be-portal.md` (staff surface).

---

## 1. Mount & Auth

```
/api/v1/public/*  — unauthenticated
/api/v1/me/*      — require Clerk client JWT + require-active + verification gate (booking endpoints only)
```

`/me/*` mounts under `routes/client/index.ts` with `clerk-client.ts` middleware (verifies the **client** Clerk app's JWT issuer; rejects staff-app tokens). `requireActiveClient` rejects `clients.status='suspended'`.

### Verification gate

`fe-client-features.md` §Auth requires `phone_verified` AND `email_verified` before any booking action. The gate reads the claims directly off the Clerk session token — there are no `clients` columns to mirror. Implementation:

```ts
// middleware/require-verified.ts
export const requireVerified: MiddlewareHandler = async (c, next) => {
  const claims = c.get('clerkClaims');
  if (!claims.email_verified || !claims.phone_verified) {
    return c.json({ error: 'verification_required', missing: { email: !claims.email_verified, phone: !claims.phone_verified }}, 403);
  }
  await next();
};
```

Applied to `bookings.ts`, `pt-sessions.ts`, `purchases.ts` only. Profile reads and waiver sign do **not** require verification (otherwise users couldn't progress past half-verified state).

---

## 2. Public endpoints — `routes/public/*`

Unauthenticated. Cache-friendly (HTTP `Cache-Control: public, max-age=60` where applicable).

### `catalog.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/locations` | List active locations |
| GET | `/classes` | List `classes` rows where `lifecycle='active'` AND `starts_at >= now()`. Filters: `?location_id`, `?class_type_id`, `?from`, `?to`, `?instructor_id`. Includes `event_state` and structured capacity (`capacity_online`, current booked count) computed at read. |
| GET | `/classes/:id` | Detail incl. instructor mini-profile, location, structured capacity, booked count |
| GET | `/workshops` | List multi-day workshops. Each row carries: `days[]` (one per `workshop_days` with starts_at, ends_at, derived `seats_left = capacity_online - booked_via_tier`), `tiers[]` (with **derived** `seats_left = min(seats_left for day in tier.day_ids)`), and resolved promotion fields (see below). |
| GET | `/workshops/:id` | Detail incl. tiers (each with derived seats-left + effective price), `tier_days{}` (which tier covers which days), images (presigned R2 URLs), instructors, description. |
| GET | `/packages` | List active class_packages + pt_packages. Each row carries resolved promotion fields. **Trial Pass first, then credit bundles, then unlimited, then PT** (matches fe-client `/packages` ordering per `fe-client-features.md` §6.1). |

**Promotion resolution shape** — every package and every workshop tier in `/packages`, `/workshops`, `/classes` responses includes:

```jsonc
{
  "regular_price_sgd": "49.00",
  "effective_price_sgd": "39.00",
  "applied_promotion": {
    "id": "...",
    "label": "Launch promo",
    "kind": "special_price"
  },
  "available_promotions": [ /* all currently-windowed active promotions for context, may exceed 1 */ ]
}
```

Resolution is server-side via `services/promotions/resolve.ts:bestPriceFor(parent_type, parent_id)` — best-price-wins, deterministic tie-break on lowest `sort_id` (`fe-client-features.md` §6.1). The client never recomputes prices.

### `marketing.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/marketing` | Singleton `marketing_content` row |

### `referral.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/referral/by-code/:code` | Resolve referral code at registration. Returns `{ valid: bool, referrer_name?: string }`. Used by fe-client `/register` to confirm the entered code; on success, the new client is registered with `referred_by_client_id` set to the resolved referrer. |

---

## 3. Authenticated client endpoints — `routes/client/*`

All endpoints prefixed with `/api/v1/me`.

### `me.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/` | Own profile: `{ name, email, phone, gender, dob, joined_at, status, waiver_signed, verification_status }`. `verification_status` is read from Clerk claims, not DB. |
| PATCH | `/` | Update `name`, `phone`, `gender`, `dob`. Email + password edits flow through Clerk directly (fe-client links to Clerk-hosted account page). |
| GET | `/dashboard` | Aggregated home payload: next-up booking, package balances (credits + sessions remaining + days to expiry), referral conversions count. One round-trip for the `/account` landing page. |
| GET | `/packages` | List `client_packages` for this client with each linked source (class_packages or pt_packages) and the `applied_promotion` frozen at purchase (if any). |
| GET | `/packages/eligibility` | `{ trial_used: bool, holds_active_bundle: bool, holds_active_unlimited: bool }` — drives fe-client `/packages` gating per `fe-client-features.md` §6.1. `trial_used` is `true` if any `client_packages WHERE client_id=me AND kind='trial'` exists (active or expired). `holds_active_bundle` / `holds_active_unlimited` derive the "Bundle excludes Unlimited and vice versa" rule. Cheap query — call on every `/packages` page load. |

### `catalog.ts` (authenticated browse)
Same shape as `routes/public/catalog.ts` but adds:
- `?include_my_bookings=true` — joins to indicate which sessions the client already booked.
- `GET /instructors` — list of bookable instructors (powers the `/private-sessions` browse page per `fe-client-features.md` §5.1). Each row includes class-type eligibility for filter chips. **No stored availability calendar** — the PT Request form (§4d below) lets clients submit any preferred slot; admin schedules and resolves conflicts at approve time.

### `bookings.ts` (verification gate applies)
| Method | Path | Effect |
|---|---|---|
| GET | `/bookings/upcoming` | `bookings WHERE client_id=me AND state='confirmed' AND session.starts_at >= now()`, joined to session detail |
| GET | `/bookings/past` | Same but `starts_at < now()`, includes `check_in_state` |
| GET | `/bookings/:id` | Detail incl. QR URL + code |
| GET | `/bookings/:id/qr` | Returns the QR image (PNG bytes) — no signed URL needed since the token is the auth |
| POST | `/bookings/class` | `{ class_id, client_package_id }` — see §4a class booking flow |
| POST | `/bookings/workshop` | `{ workshop_id, workshop_tier_id }` — initiates Stripe checkout; see §4b |
| DELETE | `/bookings/:id` | Self-cancel — see §4c |

### `pt-requests.ts` (verification gate applies)

Per `admin-restructure.md` §9 and `fe-client-features.md` §5.2, the client-facing entity is the **PT Request** — clients submit a request with their preferred slot; admin schedules a `pt_sessions` row from it.

| Method | Path | Effect |
|---|---|---|
| GET | `/pt-requests` | List own PT requests (any status). Each row carries linked `scheduled_pt_session_id` (if scheduled) plus an inlined booking for `/me/bookings` cross-display. |
| GET | `/pt-requests/:id` | Detail |
| POST | `/pt-requests` | `{ preferred_instructor_id?, preferred_starts_at, preferred_ends_at, session_type: '1on1'\|'2on1', co_client_email?, message? }`. See §4d. PT session count is **not** decremented at submission — only at admin schedule time per `fe-client-features.md` §5.2. `co_client_email` resolves to a `client_id` server-side; 422 if not found. |
| DELETE | `/pt-requests/:id` | Cancel own pending request — sets `pt_requests.status='cancelled'`. Only valid when `status='pending'`. Confirmed sessions are cancelled via `DELETE /bookings/:id` instead (which follows the §4c path and refunds the session count). |

### `pt-sessions.ts` (read-only — verification gate applies)
| Method | Path | Effect |
|---|---|---|
| GET | `/pt-sessions` | List own confirmed/cancelled PT sessions. Submission moved to `pt-requests.ts`. |
| GET | `/pt-sessions/:id` | Detail |

### `purchases.ts` (verification gate applies)
| Method | Path | Effect |
|---|---|---|
| POST | `/checkout/package` | `{ package_kind: 'class' \| 'pt', package_id }` — creates Stripe Payment Intent, returns `client_secret`. **Server resolves the best-price-wins promotion and the intent amount is derived from `effective_price_sgd`** — client-supplied price is never trusted. For `class_packages.kind='trial'`: pre-check the `(client_id) WHERE kind='trial'` partial unique index — 409 `trial_already_used` if the client already holds one. The intent metadata carries `applied_promotion_id` so the webhook can freeze it onto `client_packages`. See §4e. |
| POST | `/checkout/workshop` | `{ workshop_id, workshop_tier_id }` — same. Server resolves the workshop's best-price-wins promotion plus tier-level early-bird (early_bird wins over regular, then promotion further reduces if applicable — see §4b for the ordering). Free workshops (effective_price = 0) **bypass Stripe entirely** and route through `/workshops/:id/register` semantics inline. |
| POST | `/workshops/:id/register` | `{ workshop_tier_id }` — explicit free-workshop registration endpoint. Returns 409 if the resolved effective price is non-zero (client must use `/checkout/workshop`). Inserts a `bookings` row with `kind='workshop'`, `state='confirmed'`, `stripe_payment_intent_id=NULL` directly. Convenience: idempotent on `(client_id, workshop_tier_id)` — re-call returns the existing booking instead of erroring. |

### `invoices.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/invoices` | List `stripe_payments` for this client. Filters: `?kind`, `?year`. Each row exposes `receipt_url` for the fe-client Download button. |
| GET | `/invoices/:id` | Single payment detail |

### `waiver.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/waiver` | Singleton waiver body + own signature timestamp (or null) |
| POST | `/waiver/sign` | Insert `waiver_signatures` (unique on `client_id` — second call is a 409, sign is one-time). Required during registration; clients without a signature are blocked from booking by a service-layer check on every booking write. |

### `referral.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/referral` | Own referral code (deterministic — derived from `clients.id`, e.g. base32 of first 5 bytes) + conversion stats (count of clients with `referred_by_client_id=me` AND `referral_credit_granted_at NOT NULL`) + total credits earned via `manual_adjustments WHERE reason='referral_conversion' AND client_id=me` |

---

## 4. Client-driven business flows

### 4a. Class booking flow

`POST /me/bookings/class`:

```
services/bookings/book.ts:bookClass({ client_id, class_id, client_package_id })
  ↓
tx start
1. Verify waiver_signatures exists for client_id → else 403 waiver_unsigned
2. SELECT class FOR UPDATE (lock for capacity check)
   - lifecycle='active', starts_at > now() + 0  (no past bookings)
3. SELECT bookings count WHERE class_id=X AND state='confirmed' → if >= class.capacity: 409 class_full
4. SELECT client_packages FOR UPDATE WHERE id=client_package_id AND client_id=me
   - kind in ('credit_bundle', 'unlimited')
   - expires_at > now() OR expires_at IS NULL
   - if kind='credit_bundle': credits_or_sessions_remaining >= class.credit_cost else 422 insufficient_credits
   - if kind='unlimited': always allow (no decrement)
5. Insert bookings row: kind='class', class_id, client_package_id, state='confirmed',
   credits_or_sessions_used = (credit_bundle ? credit_cost : NULL),
   refund_outcome='n_a', check_in_state='pending'
6. Generate qr_token + code via services/bookings/qr.ts
7. If credit_bundle: UPDATE client_packages SET credits_or_sessions_remaining -= credit_cost
8. enqueueEmail('class_booking_confirmed', client.email, { class_name, date, instructor, location, qr_url, code, credits_remaining })
tx commit

Returns { booking_id, qr_token, code }
```

### 4b. Workshop booking flow (paid + free paths)

`POST /me/bookings/workshop` initiates **always** through `purchases.ts:POST /checkout/workshop` because workshop purchases go through Stripe (or skip for free).

#### Paid workshop

```
services/billing/create-intent.ts:workshopIntent({ client_id, workshop_id, workshop_tier_id })
  ↓
1. SELECT workshop_tiers FOR UPDATE; JOIN workshop_tier_days → workshop_days
   - workshops.lifecycle='active'; AT LEAST ONE covered workshop_day has starts_at > now()
2. Price resolution (in order):
   a. base = regular_price_sgd
   b. early_bird applies if (early_bird_quota set
        AND count(confirmed bookings on tier) < early_bird_quota
        AND now() < early_bird_cutoff_at): base = early_bird_price_sgd
   c. promotion = services/promotions/resolve.ts:bestPriceFor('workshop', workshop_id)
      — applies on top of base, best-price-wins; deterministic tie-break on lowest sort_id
   d. effective_price = min(base, promotion_effective_price) if promotion exists else base
3. If effective_price = 0: skip Stripe, jump to free-path below
4. Capacity check — derived tier capacity = min(day.capacity_online for day in tier.day_ids).
   tier_seats_left = capacity - count(confirmed bookings on tier).
   If tier_seats_left <= 0: 409 tier_full
   (Also rejects if any single covered day is already at capacity_online via the per-day join —
    tier capacity is min(), but a same-day overlap with another tier could still saturate.)
5. Stripe.paymentIntents.create({
     amount: effective_price * 100,
     currency: 'sgd',
     metadata: { kind: 'workshop', client_id, workshop_id, workshop_tier_id,
                 applied_promotion_id: promotion?.id ?? null }
   })
6. Insert stripe_payments row: status='pending', kind='workshop', client_id, payment_intent_id
   (booking_id stays null until success — created in webhook)
7. Return { client_secret, effective_price_sgd, applied_promotion }
```

The webhook (on `payment_intent.succeeded`) inserts the `bookings` row with `applied_promotion_id` copied from the intent metadata — freezing the promotion onto the booking so retroactive promotion edits don't rewrite history.

The webhook (`services/billing/webhook-handler.ts` on `payment_intent.succeeded`):

```
tx start
1. SELECT stripe_payments WHERE payment_intent_id=X FOR UPDATE
   - If status='succeeded': webhook is a retry, no-op (idempotent)
2. Insert bookings row: kind='workshop', workshop_id, workshop_tier_id, state='confirmed',
   client_package_id=NULL, refund_outcome='n_a', check_in_state='pending',
   stripe_payment_intent_id=X
3. Generate qr_token + code
4. Update stripe_payments: status='succeeded', receipt_url = paymentIntent.charges.data[0].receipt_url
5. enqueueEmail('workshop_purchase_confirmed', client.email, { workshop_name, date, qr_url, code, receipt_url })
6. If client.referred_by_client_id IS NOT NULL AND client.referral_credit_granted_at IS NULL:
   call services/referrals.ts:onRefereeFirstPayment(client_id) — see spine §6 (referral conversion)
tx commit
```

#### Free workshop

When `effective_price = 0`, we skip Stripe entirely:

```
tx start
1. Capacity check (same as above)
2. Insert bookings row: kind='workshop', workshop_id, workshop_tier_id, state='confirmed',
   stripe_payment_intent_id=NULL, refund_outcome='n_a', check_in_state='pending'
3. Generate qr_token + code
4. enqueueEmail('workshop_purchase_confirmed', { ..., receipt_url=NULL })
tx commit
```

The receipt UI on fe-client suppresses the Download link when `receipt_url` is null. Free workshops do not insert a `stripe_payments` row.

### 4c. Self-cancellation flow

`DELETE /me/bookings/:id` (also reused for `DELETE /me/pt-sessions/:id` post-confirm):

```
services/bookings/cancel.ts:cancel({ booking_id, source: 'client' })
  ↓
tx start
1. SELECT booking FOR UPDATE WHERE id=X AND client_id=me AND state='confirmed'
2. session = load class | workshop_tier | pt_session by booking.kind
3. If now() >= session.starts_at: 422 session_already_started
4. evaluation = services/policy/evaluate-cancellation({
     clientId: me, kind: booking.kind === 'workshop' ? 'class' : booking.kind,
     sessionStartsAt: session.starts_at,
     now()
   })
   → { refund: 'full' | 'forfeit', reason }
5. Apply refund decision:
   - kind='class' AND refund='full': UPDATE client_packages SET credits_or_sessions_remaining += booking.credits_or_sessions_used (only if kind='credit_bundle' — unlimited has no return)
     refund_outcome='credit_returned'
   - kind='class' AND refund='forfeit': refund_outcome='forfeited'
   - kind='pt' AND refund='full': UPDATE client_packages SET credits_or_sessions_remaining += 1
     refund_outcome='session_returned'
   - kind='pt' AND refund='forfeit': refund_outcome='forfeited'
   - kind='workshop': self-cancel of workshop NOT allowed in v1 (only admin can cancel a workshop and trigger refund). Return 422 workshop_self_cancel_unsupported.
6. UPDATE booking: state='cancelled', cancelled_at, refund_outcome
7. INSERT cancellations: source='client', was_within_window, was_within_cap, refund_fired (boolean per outcome), kind
8. INSERT inbox_items: type='client_cancellation', payload={ ... }
9. enqueueEmail per refund_outcome → 'class_cancelled_credit_returned' / 'class_cancelled_forfeited' / 'pt_cancelled_session_returned' / 'pt_cancelled_forfeited'
tx commit
```

The cap evaluation (step 4) is the load-bearing call. It reads `cancellations WHERE client_id=me AND source='client' AND cancelled_at >= now() - cycle_days` and counts. The admin path (`be-portal.md` §3b) bypasses this — admins always get full refund and admin cancellations are excluded from cap by the `source='admin'` filter.

### 4d. PT Request submission

`POST /me/pt-requests`:

```
services/pt-sessions/request.ts:submitRequest({
  client_id, preferred_instructor_id?, preferred_starts_at, preferred_ends_at,
  session_type, message?, co_client_email?
})
  ↓
tx start
1. Validate: now() <= preferred_starts_at <= now() + pt_booking_config.book_in_advance_days * 1d
2. Validate session_type: '1on1' → co_client_email NULL; '2on1' → co_client_email required + must resolve to a client_id
3. Soft-check both clients hold an active client_packages row with kind='pt' and remaining >= 1
   (Decrement happens at admin schedule time, NOT request time — per fe-client-features.md §5.2.
    Soft-check just avoids submitting requests that can never be scheduled.)
   → if no PT package: 422 no_pt_package
4. Insert pt_requests row: status='pending', preferred_instructor_id, preferred_starts_at,
   preferred_ends_at, session_type, co_client_id (resolved), message,
   expires_at = now() + pt_request_ttl (see §4f of admin-restructure.md / spine §5)
5. enqueueEmail('pt_request_submitted', client.email, { instructor_name?, preferred_starts_at })
tx commit
```

The request becomes a `pt_sessions` row only when admin or instructor schedules it (see `be-portal.md` §3c). Pending requests past `expires_at` are swept by the hourly `pt-request-expiry` cron — see spine §5.

**No Inbox row inserted.** Per `admin-restructure.md` §13, PT requests are not Inbox items; admin sees them on the dedicated `/admin/pt-requests` page.

### 4e. Package purchase flow

`POST /me/checkout/package`:

```
services/billing/create-intent.ts:packageIntent({ client_id, package_kind, package_id })
  ↓
1. Load class_packages or pt_packages, validate status='active'
2. Eligibility gates (mirror /me/packages/eligibility):
   - class_packages.kind='trial' → reject 409 trial_already_used if client_packages row with kind='trial'
     exists for this client (active OR expired). Defence-in-depth: the partial unique index will also catch.
   - class_packages.kind='credit_bundle' → reject 409 conflicting_active_package if client holds active 'unlimited'
   - class_packages.kind='unlimited' → reject 409 conflicting_active_package if client holds active 'credit_bundle'
   (trial + bundle/unlimited can coexist; PT is independent of all three)
3. Promotion resolution:
   promotion = services/promotions/resolve.ts:bestPriceFor(
     package_kind === 'class' ? 'class_package' : 'pt_package', package_id
   )
   effective_price = min(package.price_sgd, promotion_effective_price) if promotion else package.price_sgd
4. If effective_price = 0 AND package_kind='class' AND kind='trial':
   skip Stripe, insert client_packages row directly (free Trial Pass), enqueue confirmation email
5. Stripe.paymentIntents.create({
     amount: effective_price * 100,
     currency: 'sgd',
     metadata: { kind: package_kind === 'class' ? 'class_package' : 'pt_package',
                 client_id, package_id, applied_promotion_id: promotion?.id ?? null }
   })
6. Insert stripe_payments: status='pending', kind, client_id, payment_intent_id
7. Return { client_secret, effective_price_sgd, applied_promotion }
```

Webhook on success (`services/billing/webhook-handler.ts`):

```
tx start
1. SELECT stripe_payments FOR UPDATE WHERE payment_intent_id=X
   - If status='succeeded': retry, no-op
2. Insert client_packages: kind matches source package's kind (credit_bundle | unlimited | trial | pt),
   source_class_package_id or source_pt_package_id,
   applied_promotion_id = intent.metadata.applied_promotion_id (frozen — promotion edits won't rewrite),
   credits_or_sessions_remaining = (credit_bundle | trial ? credits : pt ? num_sessions : NULL),
   expires_at = (credit_bundle ? now + validity_days
                : trial ? (validity_days IS NULL ? NULL : now + validity_days)
                : unlimited ? now + duration_days
                : NULL),
   purchased_at = now(),
   amount_paid_sgd = stripe_payments.amount_sgd,
   stripe_payment_intent_id = X
   (Trial unique partial index catches any race — if a concurrent purchase already inserted a trial
    for this client, this INSERT raises 23505 and the webhook handler logs it then no-ops.)
3. Update stripe_payments: status='succeeded', client_package_id, receipt_url
4. enqueueEmail — branches on package kind:
   - kind='trial' → 'trial_pass_purchase_confirmed' (friendlier intro copy)
   - kind in (credit_bundle, unlimited, pt) → 'package_purchase_confirmed'
   Both receive { package_name, credits_or_sessions, expires_at, receipt_url, applied_promotion_label? }
5. Referral conversion check (same as workshop §4b)
tx commit
```

### 4f. Registration flow

Not a single endpoint — orchestrated across Clerk + our backend:

1. fe-client `/register` collects `{ email, password, name, phone, gender?, dob?, referral_code? }`.
2. fe-client calls Clerk's signUp API → Clerk creates the user, sends email + SMS verification.
3. **Webhook `user.created`** fires from Clerk → `services/auth/webhook-sync.ts`:
   - Looks for an existing `clients` row by email (idempotency).
   - If absent: insert `clients` row with `clerk_user_id`, name, phone, gender, dob, referred_by_client_id (resolved via the public referral endpoint at fe-client step 1 if a code was entered).
   - Returns 200 to Clerk.
4. fe-client redirects to `/waiver`. Client signs → `POST /me/waiver/sign` → inserts `waiver_signatures`.
5. fe-client surfaces verification CTA until both Clerk verifications complete.
6. Once both verifications complete, the verification gate (§1) lets booking endpoints through.

The dual-claim verification check on every booking request is the only gate; we do not store verification state.

### 4g. Referral conversion (cross-link)

The trigger and idempotency live with the client app because the **referee** is a client. The credited party (referrer) is also a client. The implementation is documented in spine §6 ("Referral conversion crediting") — both webhook-driven flows (workshop purchase, package purchase) call `services/referrals.ts:onRefereeFirstPayment(client_id)` at the end of their commit.

Endpoints exposing the result on the client side:
- `GET /me/referral` — own code + conversion stats (above).
- `GET /api/v1/public/referral/by-code/:code` — resolve at registration (above).

The portal does not expose referral endpoints in v1; admin sees referral chain on the client profile page (`be-portal.md` §2 → `clients.ts:GET /clients/:id`).

---

## 5. What lives in the spine, not here

These belong to `backend-architecture.md` and are referenced from the client flows above without redefinition:

- **DB schema** — every table (clients, bookings, client_packages, etc.) is defined in spine §3.
- **Booking code + QR token generation** — spine §6 (`services/bookings/qr.ts`).
- **Event state computation** — spine §6.
- **Cancellation evaluation algorithm** — spine §6 (`services/policy/evaluate-cancellation.ts`); the client path calls it (see §4c).
- **Stripe Payment Intents + receipt URL population** — spine §4 (External integrations).
- **SMTP transport + template rendering** — spine §4.
- **Referral conversion idempotency mechanic** — spine §6.
- **Background job schedulers** (`credit-expiry` reminders fire to clients, but the schedule lives in the spine).
- **Migrations + seed** — spine §7.

---

## 6. Open client-side questions

1. **Workshop self-cancel.** v1 disallows; only admin can cancel a workshop. If we later want clients to self-cancel a workshop registration with policy-driven Stripe refund, add a path through `services/bookings/cancel.ts` that decides `refund: 'stripe_refund' | 'forfeit'` based on a workshop-specific window.
2. **Half-verified UX.** The verification gate returns `403 verification_required` with `{ missing: { email: bool, phone: bool }}` — fe-client decides which CTA to surface. Confirm fe-client expects this exact shape.
3. **Referral code format.** Currently proposed as base32 of first 5 bytes of `clients.id` — collision-free (uuid is the source) and short enough to type. Confirm with fe-client.
4. **PT session edit.** v1 has no edit on a `status='pending'` PT request — client must cancel + re-request. Adding edit is straightforward (PATCH on pending) but deferred.
