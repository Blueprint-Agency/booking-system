# Backend — Client (`fe-client`)

The client-side backend surface. Implements the `/me/*` scope of the client app plus the unauthenticated `/public/*` reads used by the marketing pages and registration flow. Reads from `fe-client-features.md` for **behavior**; this doc maps that behavior onto routes, services, and database tables defined in `backend-architecture.md`.

- Spine: `backend-architecture.md` (stack, folder structure, full DB schema, integrations, jobs, shared cross-cutting).
- Behavior source of truth: `fe-client-features.md`.
- Sister doc: `be-portal.md` (staff surface).

---

## 1. Mount & Auth

```
/api/v1/public/*  — unauthenticated
/api/v1/me/*      — require a member session + require-active + verification gate (booking endpoints only)
```

`/me/*` mounts under `routes/client/index.ts` with `clientAuth` (`middleware/client-auth.ts`): a Better Auth `client` pool bearer session whose Tenant claim is this studio, and the member's `clients` row at this studio, linked by `auth_user_id` (404 `client_not_found` otherwise — nothing is provisioned on a request). Any other token is 401 `invalid_token`. Staff and platform sessions are rows the client pool has never seen, so they are 401. `requireActiveClient` rejects `clients.status='suspended'` and blocked (`deleted_at`) members.

### Impersonation (#118)

A studio superadmin impersonates a member from the portal: `POST /api/v1/portal/admin/clients/:id/impersonate` (superadmin only; the lookup is scoped to the superadmin's studio, so another studio's member is 404; a blocked member is 422 `client_blocked`) opens a real `client` pool session for the member — `client_auth_sessions.impersonated_by` set to the superadmin's staff auth user, one hour, stamped with the studio's claim — and returns `{ token, grant, fe_client_url }`. `fe_client_url` is `{studio member app}/impersonate#token=…&grant=…`; the fragment keeps the token out of every server log.

The member app adopts the token as its session and sends the grant on every call as `X-Impersonation-Grant`. `client-impersonation.ts` checks it after the session: the two only work together — an impersonation session without a valid grant, or a grant on a session that is not an impersonation, is 401 `impersonation_grant_mismatch`; a grant whose subject is not the session's auth user is 401 `impersonation_subject_mismatch`, one minted at another studio 401 `impersonation_tenant_mismatch`; a match sets `impersonatedBy` (the superadmin's `staff_users.id`) and `impersonatedClientId`, and `audit_log` names both on every write. Stopping signs the session out through the client pool (`/api/v1/auth/client/sign-out`), so a sibling tab is 401 on its next request. Start and end are `auth_events` rows (`impersonation_started`, `impersonation_ended`), filed under the `staff` pool with the superadmin as actor and the member as subject.

### Verification gate

`fe-client-features.md` §Auth requires `phone_verified` AND `email_verified` before any booking action. **Not built.** A member signs in only by a code mailed to their address, so every session already proves the email; phone verification has no source yet, and when it gets one it belongs on the `client` pool user, not in `clients`. When built, it applies to `bookings.ts`, `pt-sessions.ts`, `purchases.ts` only — profile reads and waiver sign must not require it (otherwise users couldn't progress past half-verified state).

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
| GET | `/corporate-packages` | List active `corporate_packages`. Shape: `{ corporate_packages: [{ id, name, description, price_sgd, status }] }`. Same shape as the authenticated `/me/corporate-packages`. |
| GET | `/merch` | List merch items where `archived_at IS NULL`, title-ordered. Shape: `{ merch: [{ id, title, description, price_sgd, image_url, archived_at }] }` — `image_url` is the unsigned R2 public URL (null when unset or storage unconfigured). Browse-only and priced the same for everyone, so there is no authenticated variant. |

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

### `tenants.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/tenants/by-slug/:slug` | Resolve a subdomain slug to the tenant's identity + display settings: `{ tenant: { id, slug, name, timezone, status }, settings: { display_name, logo_url, favicon_url, og_image_url, tagline, theme, copy } }`. Unauthenticated and cacheable (`Cache-Control: public, max-age=60, stale-while-revalidate=300`) because it sits on **every** request path — the frontend proxies call it for each incoming Host header, since the three apps stay decoupled and the frontends may not query the database. Unknown, archived and malformed slugs all return the standard `404 { "error": "not_found" }`, byte for byte, so the response cannot be used to enumerate tenants. Mail-from identity and waiver text are deliberately not in the payload. |

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
| GET | `/` | Own profile: `{ name, email, phone, gender, dob, joined_at, status, waiver_signed }`. |
| PATCH | `/` | Update `name`, `phone`, `gender`, `dob`. The password is changed through the auth pool (§4f), not here, and changing the email is not offered. |
| GET | `/dashboard` | Aggregated home payload: next-up booking, package balances (credits + sessions remaining + days to expiry), referral conversions count. One round-trip for the `/account` landing page. |
| GET | `/packages` | List `client_packages` for this client with each linked source (class_packages or pt_packages) and the `applied_promotion` frozen at purchase (if any). Each row carries `cross_location_paid_sgd` — null means the plan Covers its Home Location only. The `entitlements` block also carries `unlimited_plan_id` (the plan a **Cross-Location Add-On** would attach to), `unlimited_covers_both` (it already carries one) and `cross_location_rate_sgd` (the Global Policy rate right now), which is what the member surfaces quote the Add-On at. The same three appear on `/me/class-packages`, where the schedule's blocked-class nudge reads them. |
| GET | `/packages/eligibility` | `{ trial_used: bool, holds_active_bundle: bool, holds_active_unlimited: bool }` — drives fe-client `/packages` gating per `fe-client-features.md` §6.1. `trial_used` is `true` if any `client_packages WHERE client_id=me AND kind='trial'` exists (active or expired). `holds_active_bundle` / `holds_active_unlimited` derive the "Bundle excludes Unlimited and vice versa" rule. Cheap query — call on every `/packages` page load. |
| GET | `/corporate-packages` | List active `corporate_packages`: `{ corporate_packages: [{ id, name, description, price_sgd, status }] }`. Powers the fe-client Corporate catalog (`fe-client-features.md` §6.2). |
| GET | `/corporate-requests` | The client's own corporate requests: `{ corporate_requests: [{ id, status, package: { id, name }, created_at, session: null \| { starts_at, ends_at, location_name, instructor_name } }] }`. `session` is populated when `status='scheduled'`. Drives the `/account/corporate` status page. |

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
| POST | `/bookings/class` | `{ class_id, use_credits? }` — see §4a class booking flow. The server picks the package; `use_credits: true` is the one exception (spec §2), asking to pay with credits for a class the member's Unlimited Plan does not cover. |
| POST | `/bookings/workshop` | `{ workshop_id, workshop_tier_id }` — initiates Stripe checkout; see §4b |
| DELETE | `/bookings/:id` | Self-cancel — see §4c |

### `pt-sessions.ts` (verification gate applies)

Per `admin-restructure.md` §9 and `fe-client-features.md` §5.2, the client-facing entity is the **PT Request**. The route file is named `pt-sessions.ts` because requests and their scheduled sessions are paired 1:1 and the FE renders them together; the URL space is `/me/pt-sessions/*`.

| Method | Path | Effect |
|---|---|---|
| GET | `/pt-sessions` | List PT requests the caller is on — either as the requester **or** as the 2on1 partner (`co_client_id`), any status. Each row carries `role: 'requester'\|'partner'` and `host_name` (the requester's name, for partner cards); the linked `pt_sessions` row when `status='scheduled'` (final date/time/location/room/instructor + the **caller's own** booking/qr/code) so the FE renders one card per request without a follow-up call. Partner rows are read-only (cancel is requester-only, enforced in `cancel.ts`) and omit the requester's private `message`. |
| GET | `/pt-sessions/:id` | Detail |
| GET | `/pt-sessions/partner-lookup?email=<email>` | Exact-match email lookup for 2on1 partner autocomplete. Returns `{ found: false }` OR `{ found: true, client_id, name }`. Used by the request form — leaks nothing beyond presence + display name. |
| POST | `/pt-sessions/request` | Submit. Body: `{ class_type_id, location_id, session_type: '1on1'\|'2on1', client_package_id, slots: [{ proposed_date, start_time, end_time }, ...], message?, partner?: { kind: 'existing', co_client_id } \| { kind: 'new', name, email } }`. `location_id` is the studio the client wants the session at (required; powers the portal's workspace-scoped triage queue). See §4d. **Debits the source package immediately** — 1 session for 1on1, 2 for 2on1. 422 `insufficient_pt_sessions` if balance < required. 422 `partner_required` if 2on1 without `partner`. |
| POST | `/pt-sessions/:id/cancel` | Cancel own request. Branches on current status — `pending` → `cancelled_before_scheduled` + refund; `scheduled` → `cancelled_after_scheduled` (no refund, cascades through linked `pt_sessions` + bookings). Calls into the same `services/pt-sessions/cancel.ts:cancelPtRequest` the admin route uses, with `source='client'`. Idempotent on terminal states. |

### `purchases.ts` (verification gate applies)
| Method | Path | Effect |
|---|---|---|
| POST | `/checkout/package` | `{ package_kind: 'class' \| 'pt' \| 'corporate', package_id, promo_code?, location_id? }` — creates Stripe checkout, returns `{ url }`. `location_id` is the Home Location the member picked on the review page: **required** for `class_packages.kind='unlimited'` (400 `unlimited_requires_location`), refused for every other kind (400 `location_only_applies_to_unlimited`), and 409 `unlimited_renewal_location_mismatch` when the client holds a live Unlimited Plan at another Location (§6). A member holds one Activated plan plus at most one Dormant, so a third live plan is refused with 409 `unlimited_limit_reached` (§6) — the other Location is the Add-On, not another plan. The same rules run again in the grant; running them here is what stops a member being charged for a purchase the webhook would refuse. It rides the intent metadata as `location_id` so the webhook can freeze it onto `client_packages`. **Server resolves the best-price-wins promotion and the intent amount is derived from `effective_price_sgd`** — client-supplied price is never trusted. For `class_packages.kind='trial'`: pre-check the `(client_id) WHERE kind='trial'` partial unique index — 409 `trial_already_used` if the client already holds one. The intent metadata carries `applied_promotion_id` so the webhook can freeze it onto `client_packages`. **`package_kind='corporate'`** is paid (no promotions); on success the webhook records a `stripe_payments` row (kind `corporate_package`) and auto-creates ONE pending `corporate_requests` row — it does **not** insert a `client_packages` row (no credits; the request is the entitlement). See §4e. |
| POST | `/checkout/cross-location/quote` | `{ client_package_id }` — prices the **Cross-Location Add-On** against a plan the member already holds (§5). Returns `{ client_package_id, months, rate_sgd, price_sgd }`: months is the plan's whole months remaining with part months rounded up, or its full stored Duration while Dormant, and the rate is read from Global Policy at this moment. 400 `cross_location_requires_unlimited`, 400 `cross_location_plan_not_live`, 409 `cross_location_already_added` — one Add-On per plan, never two. |
| POST | `/checkout/cross-location` | `{ client_package_id }` — the same refusals, then its own Stripe session carrying `kind='cross_location_add_on'` and `client_package_id` in the metadata; the webhook fills `client_packages.cross_location_paid_sgd` on the named plan. Bought **with** a plan instead, it rides `/checkout/package` as `cross_location_add_on: true` — one session, two line items, `amount_sgd` (plan) plus `cross_location_sgd` (Add-On) equalling the charge. A Promo Code discounts the plan line only: the Add-On is a Global Policy rate, not a product. |
| POST | `/checkout/workshop` | `{ workshop_id, workshop_tier_id }` — same. Server resolves the workshop's best-price-wins promotion plus tier-level early-bird (early_bird wins over regular, then promotion further reduces if applicable — see §4b for the ordering). Free workshops (effective_price = 0) **bypass Stripe entirely** and route through `/workshops/:id/register` semantics inline. |
| POST | `/workshops/:id/register` | `{ workshop_tier_id }` — explicit free-workshop registration endpoint. Returns 409 if the resolved effective price is non-zero (client must use `/checkout/workshop`). Inserts a `bookings` row with `kind='workshop'`, `state='confirmed'`, `purchase_id=NULL` directly. Convenience: idempotent on `(client_id, workshop_tier_id)` — re-call returns the existing booking instead of erroring. |
| POST | `/checkout/merch` | `{ merch_id }` — one item, no Promo Code and no review page: creates a Stripe checkout and returns `{ url }`. 404 `merch_not_found`, 400 `merch_not_available` (archived). A merch item priced at 0 bypasses Stripe and returns `{ outcome: 'granted', order_id, free: true }` with the order already written. The intent metadata carries `kind='merch'`, `merch_id`, `merch_title` and `amount_sgd`; the webhook records a `stripe_payments` row (kind `merch`) plus one `merch_orders` row, idempotent on the payment intent. Nothing is granted and nothing is booked — merch is handed over physically at the studio, which is what the fe-client notice says. |
| GET | `/merch-orders` | This client's merch purchase history, newest first. Shape: `{ orders: [{ id, merch_id, title, amount_sgd, purchased_at }] }`. `title` and `amount_sgd` are frozen at purchase and `merch_id` goes null if the catalogue row is deleted, so history reads as what was actually bought. |

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
services/bookings/book.ts:bookClass({ client_id, class_id, use_credits? })
  ↓
tx start
1. Verify waiver_signatures exists for client_id → else 403 waiver_unsigned
2. SELECT class FOR UPDATE (lock for capacity check)
   - lifecycle='active', starts_at > now() + 0  (no past bookings)
3. SELECT bookings count WHERE class_id=X AND state='confirmed' → if >= class.capacity: 409 class_full
4. Sweep the member's own expired-but-still-active rows (services/packages/activation.ts),
   then SELECT client_packages FOR UPDATE WHERE client_id=me AND active
   → services/packages/selection.ts:selectPackage (pure; spec §2, ADR 0004)
   - one Activated package per class family (bundle + Unlimited + trial). If one
     is running it is the ONLY candidate: a running plan must cover the Location
     (409 location_not_covered) and last to the class (409 plan_expires_before_class);
     a running bundle must have enough credits (409 insufficient_credits) and last
     to the class. Nothing waiting behind it starts, use_credits or not.
   - nothing running: the Dormant package bought first starts on this booking —
     a plan covering the Location (prospective test: now + duration_months >= class
     start), unless use_credits, then a bundle/trial (now + validity_days >= class
     start). A plan that covers nothing here → 409 location_not_covered, NOT a
     silent fall-through to credits.
5. Insert bookings row: kind='class', class_id, client_package_id, state='confirmed',
   credits_or_sessions_used = (credit_bundle ? credit_cost : NULL),
   refund_outcome='n_a', check_in_state='pending'
6. Generate qr_token + code via services/bookings/qr.ts
7. If credit_bundle: UPDATE client_packages SET credits_or_sessions_remaining -= credit_cost
7b. Activation (§3, ADR 0004): if the chosen package was Dormant, UPDATE client_packages
   SET expires_at = booking moment + duration_months (Unlimited) or + validity_days
   (every other kind). One-way — no cancellation un-stamps it. A second Activated
   package in the family trips the partial unique index → 409 family_already_activated.
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
   purchase_id=P            — the sale; a Refund routes on it, not on the intent (#92)
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
   purchase_id=NULL, refund_outcome='n_a', check_in_state='pending'
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

`POST /me/pt-sessions/request`:

```
services/pt-sessions/request.ts:submitPtRequest({
  client_id, class_type_id, location_id, session_type, client_package_id,
  slots: [{ proposed_date, start_time, end_time }, ...],   // 1..N
  message?,
  partner?: { kind: 'existing', co_client_id }            // 2on1, partner is a member
           | { kind: 'new', name, email }                  // 2on1, partner is not yet a member
})
  ↓
tx start
1. Validate class_type_id exists and is active. Validate location_id exists and is not archived.
2. Validate slots[]: 1..N rows; each end_time > start_time; each proposed_date in
   [today, today + pt_booking_config.book_in_advance_days] (local SGT date math).
3. Validate session_type:
   '1on1' → partner MUST be omitted.
   '2on1' → partner REQUIRED. If kind='existing', co_client_id MUST be a different active client.
            If kind='new', email MUST NOT match any existing client (otherwise the FE should have
            collapsed to 'existing' via /partner-lookup; reject 422 partner_should_be_existing).
4. Sweep the member's expired-but-active rows, then SELECT client_packages FOR UPDATE
   WHERE id=client_package_id AND client_id=ctx.client_id.
   Required: kind='pt', not expired, session_type matches, credits_or_sessions_remaining >=
   (1 for 1on1, 2 for 2on1) → else 422 insufficient_pt_sessions.
   One Activated PT package at a time (ADR 0004): if a DIFFERENT PT package is running
   → 409 pt_package_not_current. If the chosen one is Dormant, this request Activates it:
   expires_at = now + validity_days (409 family_already_activated on a race).
5. DEBIT the package: credits_or_sessions_remaining -= (1 for 1on1, 2 for 2on1).
   The debit is recorded against pt_requests.id via the manual_adjustments shape with
   reason='pt_request_submit' so cancellation can reverse it precisely.
6. Insert pt_requests row: status='pending', class_type_id, location_id, session_type,
   co_client_id | co_client_name + co_client_email (depending on partner.kind),
   message, expires_at = now() + pt_request_ttl (see spine §5).
7. Insert pt_request_slots rows for each entry in slots[].
8. enqueueEmail('pt_request_submitted', client.email, { class_type_name, slots, partner_label }).
9. enqueueEmail('pt_request_submitted_admin', studio_inbox, ...) — admin gets a heads-up email
   so the WhatsApp follow-up can start without polling /admin/pt-requests.
tx commit
```

The request becomes a `pt_sessions` row only when admin (or instructor) schedules it via `be-portal.md` §3c. **No back-and-forth in app**: all date/time negotiation, partner clarification, and instructor matching happens on WhatsApp out-of-band; the admin records the final outcome by scheduling or cancelling.

Pending requests past `expires_at` are swept by the `pt-request-expiry` cron (every 5 min) — it routes through the same `services/pt-sessions/cancel.ts:cancelPtRequest` `'pending'` branch with `source='system'`, refunding the debit.

**No Inbox row inserted** on submit — admin sees pending requests on `/admin/pt-requests`. Inbox rows are reserved for cancellation notifications per `admin-restructure.md` §13.

### 4e. Package purchase flow

The dead `/checkout` page is live: every paid purchase — class/PT package, workshop tier, standalone Cross-Location Add-On — routes through the review step (`fe-client-features.md` §7) before Stripe. Routes live in `routes/client/purchases.ts`.

`POST /me/checkout/validate-promo` — `{ code, package_kind + package_id | workshop_id + workshop_tier_id }`. A **preview, not a claim**: the code's place is claimed when checkout actually starts, not here. `services/packages/promo-redemption.ts:previewPromoCode()` normalises the code (trim, upper-case), matches it against the named product (the product travels with the code because the endpoint can't answer the scope case otherwise), and returns `{ valid: true, promo_code_id, discount_sgd, effective_price_sgd }` or `{ valid: false, reason }` — always `200`, never a thrown error, with the same one of five reasons checkout itself refuses on (`promo-codes.ts`: expired, cap reached, already redeemed, out of scope, unknown-or-archived — the last two share one message on purpose).

`POST /me/checkout/package` — `{ package_kind, package_id, promo_code?, location_id?, instructor_id?, cross_location_add_on? }`:

```
services/packages/purchase.ts
  ↓
1. Load class_packages or pt_packages, validate status='active'
2. Eligibility gates (mirror /me/packages/eligibility):
   - class_packages.kind='trial' → reject 409 trial_already_used if client_packages row with kind='trial'
     exists for this client (active OR expired). Defence-in-depth: the partial unique index will also catch.
   - class_packages.kind='unlimited' → assertPurchasableLocation(): location_id is REQUIRED
     (409 unlimited_requires_location), one Activated plus at most one Dormant plan per client
     (409 unlimited_limit_reached on a third), and a renewal bought while a live plan exists may only pick
     that plan's own Home Location (409 unlimited_renewal_location_mismatch otherwise) — see
     `class-booking-lifecycle.md` §1a and `spec-pre-launch-batch.md` §6
   - pt_packages.instructor_bound=true → resolveBoundInstructor(): instructor_id is REQUIRED
     (400 pt_bound_requires_instructor) and must be an active instructor of this Tenant
     (400 instructor_not_active). On an unbound PT package, and on every class package,
     an instructor_id is refused rather than ignored (400 instructor_only_applies_to_bound_pt).
     `instructorForPurchase()` is the pure rule and `resolveBoundInstructor()` the one place it
     meets the roster; the grant calls the same function for the id it stores, so this run is
     purely what stops a member paying for a purchase the webhook would refuse.
   (a Credit Bundle and an Unlimited Plan may now be held together — the old mutual-exclusion gate this
    section described is gone, superseded by user story 25's "spend a credit outside my plan's coverage
    instead of being blocked"; PT is independent of all three)
3. Promotion resolution — unchanged: services/promotions/resolve.ts:bestPriceFor(...), best-price-wins.
4. Promo Code: if promo_code is present, holdPromoCode() locks the code row, counts used slots
   (`status='consumed' OR held_until > now()`), and upserts a `held` redemption row
   (`held_until = now() + 30min` when the code is capped — otherwise the standard 24h session applies).
   A bad code refuses the whole checkout with 400 promo_code_invalid — never a silent full-price charge.
   effective_price = promotion price, minus the code's discount, floored at zero.
5. Cross-Location Add-On, if cross_location_add_on=true: priceCrossLocationForNewPlan() prices at the plan's
   full stored Duration × the Global Policy rate (a Dormant plan has no partial month to round). Carried as
   its own metadata field and its own money — never inside the plan's price, never discounted by the code.
6. If effective_price = 0 (a $0 trial, or a code/promotion that drives any package to zero):
   skip Stripe, grantPackage() directly (carrying instructor_id, which has no session metadata to ride),
   redemption row (if any) written straight to `consumed`,
   send the purchase confirmation synchronously (§13, below) — the free path this batch added.
7. Stripe.paymentIntents.create({
     amount: (effective_price + cross_location_sgd) * 100,
     currency: 'sgd',
     metadata: { kind: package_kind === 'class' ? 'class_package' : 'pt_package',
                 client_id, package_id, location_id, instructor_id, cross_location_sgd,
                 applied_promotion_id, applied_promo_code_id }
   }, { expires_at: matches the redemption hold when the code is capped, else the standard 24h })
8. Insert stripe_payments: status='pending', kind, client_id, payment_intent_id
9. Return { client_secret, effective_price_sgd, applied_promotion, applied_promo_code }
```

`POST /me/checkout/cross-location/quote` and `POST /me/checkout/cross-location` — the **standalone** Add-On purchase against a plan the member already holds, entered from the account page or a blocked-class nudge (`fe-client-features.md` §7). The quote reads `quoteCrossLocationAddOn()` (months remaining, rounded up, × the Global Policy rate — the remainder sentence renders from this before the arithmetic); the purchase mints its own Stripe session tagged `kind: 'cross_location_add_on'` in metadata rather than reusing the plan's payment-intent column, which the plan's own purchase already owns. Refused with `409 cross_location_already_added` when the target plan already carries one, `400 cross_location_plan_not_live` when it's not the member's own live plan, and `400 cross_location_requires_unlimited` when the target isn't an Unlimited Plan at all.

Webhook on success (`services/billing/webhook-handler.ts`):

```
tx start
1. SELECT stripe_payments FOR UPDATE WHERE payment_intent_id=X
   - If status='succeeded': retry, no-op
2. Insert client_packages: kind matches source package's kind (credit_bundle | unlimited | trial | pt),
   source_class_package_id or source_pt_package_id,
   applied_promotion_id / applied_promo_code_id = intent.metadata (frozen — later edits won't rewrite),
   location_id = intent.metadata.location_id (unlimited only),
   duration_months = the catalogue's duration, frozen (unlimited only),
   cross_location_paid_sgd = intent.metadata.cross_location_sgd (unlimited only, nullable),
   credits_or_sessions_remaining = (credit_bundle | trial ? credits : pt ? num_sessions : NULL),
   expires_at = (credit_bundle ? now + validity_days
                : trial ? (validity_days IS NULL ? NULL : now + validity_days)
                : unlimited, no live plan in front ? now + duration_months  — NOT Dormant, real end date
                : unlimited, a live plan already running ? NULL             — Dormant, clock waits
                : NULL),
   purchased_at = now(),
   amount_paid_sgd = stripe_payments.amount_sgd,
   purchase_id = P
   (Trial unique partial index catches any race — if a concurrent purchase already inserted a trial
    for this client, this INSERT raises 23505 and the webhook handler logs it then no-ops.)

   A standalone Cross-Location Add-On payment (metadata kind='cross_location_add_on') takes a different
   branch: it loads the named plan and writes cross_location_paid_sgd onto the EXISTING row rather than
   inserting a new one. ponytail gap, left open by #26 and reviewed at #30: two concurrent standalone
   Add-On sessions against the same plan can both reach this branch, since the check for "does it already
   carry one" happens at checkout, before either payment lands. The loser's write is a no-op — the column
   is already set — and it is logged as a refund owed rather than silently swallowed. Upgrade path: let the
   webhook issue the provider refund itself; not built here because it is not this ticket's decision to make
   (an admin issues refunds, per §14).
3. Redemption row, if any, flips 'held' → 'consumed' (stamped time + payment intent) — the hold and the
   payment session share an expiry, so a member who has paid can never be told afterwards the code ran out.
4. Update stripe_payments: status='succeeded', client_package_id, receipt_url (payment intent retrieved with
   the latest charge expanded — the completed-session event itself carries no charge object)
5. enqueueEmail — the purchase confirmation (§13, below), fired only when this insert actually created the
   row (`created: boolean` returned by the grant, not a webhook-retry guard — the two payment-intent unique
   indexes are the real lock)
6. Referral conversion check (same as workshop §4b)
tx commit
```

#### Purchase confirmation emails (§13)

Four paths send, one deliberately does not:

| Path | Slug | Condition |
|---|---|---|
| Paid class / PT package | branches on granted `kind` → `package_purchase_confirmed` | `created` |
| Paid workshop | `workshop_purchase_confirmed` | `created` |
| $0 trial pass | `trial_pass_purchase_confirmed` | always |
| $0 workshop tier | `workshop_purchase_confirmed` | always — this closed a real gap: a free workshop booking produced a QR and a date and no email at all before this batch |
| Admin comp grant | — | **never** — a comp grant is not a purchase, and announcing an admin's action to someone who did not ask is the wrong default |

The slug is decided by the granted package's **kind**, not by which code path granted it — a *priced* trial still goes through Stripe and the webhook, so branching on the path would send it the paid-package copy. `services/notifications/purchase-email.ts:composePurchaseEmail()` builds two whole composed sentences per send (the renderer is substitution-only with no conditionals, so a fragment-shaped variable produces a wrong sentence for some kind):

- `contents_line` — "Unlimited classes" · "10 class credits" · "5 private sessions" · "3 classes" (trial, which counts classes rather than credits — a first-timer has never heard of a credit).
- `validity_line` — **reads `isDormant`, not the package kind.** A Dormant Unlimited Plan (bought while a live plan is still running) is the only purchase with no date, so it alone gets "Valid 6 months from your first class — your plan activates when you make your first booking," reading the frozen `duration_months`. **An Unlimited Plan bought with no live plan in front is not Dormant** — its clock started at purchase, it has a real end date already stamped on the row, and its email prints that date exactly like a Credit Bundle's does. This is a deliberate deviation from an earlier reading of the spec that branched on package kind alone; the shipped code branches on `isDormant` because the promise "activates on your first booking" would otherwise be printed on a plan that had already started.

`receipt_url` is never empty: a paid purchase gets the Stripe receipt (retrieved with the latest charge expanded, since the webhook's own event carries none), a free one falls back to the account page with neutral anchor text — an escaped empty string in an href is a visible link to nowhere, which is not a safe default here.

The helper (`services/notifications/send-purchase-email.ts`) wraps its entire body in try/catch: `sendTemplatedEmail` throws on an unknown slug, and thrown from inside a webhook after the grant already committed, the delivery is lost permanently while the purchase looks fine. Swallowing here is what makes the `created` flag a safe guard against double-sending on a provider retry.

#### Corporate branch (`package_kind='corporate'`)

Corporate is **paid, no promotions**, and grants no credits. `packageIntent` loads `corporate_packages` (status must be `active`), charges `price_sgd`, and tags the intent metadata `kind='corporate_package'`. The webhook diverges from the class/PT grant above:

```
tx start
1. SELECT stripe_payments FOR UPDATE WHERE payment_intent_id=X — retry no-op if succeeded
2. Insert NO client_packages row (corporate buys grant no credits)
3. Insert corporate_requests: status='pending', client_id, corporate_package_id (from metadata),
   message=NULL  — this pending request is the entitlement; scheduling happens in the portal
4. Update stripe_payments: status='succeeded', kind='corporate_package', receipt_url
5. enqueueEmail('corporate_request_submitted' equivalent — confirmation that the studio will reach out on WhatsApp)
tx commit
```

The client then tracks the request on `/account/corporate` (`fe-client-features.md` §8.8); the studio schedules it via `be-portal.md` §3f.

### 4f. Registration flow

Members sign in with email and password through the Better Auth `client` pool (#173, `docs/adr/0005-member-passwords.md`). The emailed one-time code only proves an address at sign-up. No webhook and no provisioning on first request: the account and the studio's row are written together.

1. fe-client `/register` collects `{ first_name, last_name, email, phone, password }` (password 8–128 characters) and asks the pool for a code: `POST /api/v1/auth/client/email-otp/send-verification-otp` `{ email, type: 'sign-in' }`.
2. It sends the code with the details to **`POST /api/v1/public/members/register`** `{ email, otp, first_name, last_name, phone, password }` (`services/clients/register.ts`):
   - 409 `already_member` if this studio already has a `clients` row for the address — sign in instead.
   - The code is checked; a wrong one is 400 `invalid_otp` / `otp_expired` (403 `too_many_attempts`) and writes nothing but the attempt.
   - Then, in one savepoint: the `client_auth_users` row (found, not duplicated, when the person is already a member at another studio), its password (replacing any — the code just proved the email), the `clients` row with `auth_user_id`, the code spent, and the session — signed in through the pool's own `/sign-in/email`, so it meets the same origin check, rate limits, audit row and Tenant stamp as any sign-in.
   - Answers `{ token }` (also in `set-auth-token`): the member is signed in at this studio.
3. An existing member signs in in two steps:
   - **`POST /api/v1/public/members/sign-in-step`** `{ email }` → `{ next: 'password' }` when the address has a password, else `{ next: 'link_sent' }`. For `link_sent` a set-password link is mailed if the address is an unblocked member of this studio, and nothing otherwise — the answer is the same.
   - With a password: `POST /api/v1/auth/client/sign-in/email` `{ email, password }`. A wrong one is 401 `INVALID_EMAIL_OR_PASSWORD` and a `sign_in_failed` Auth event. A member this studio has blocked is refused, 403 `client_blocked` (the pool's session hook reads `clients.deleted_at` at the resolved Tenant).
4. The link (`password_reset` template, single use, 30 minutes) opens `/api/v1/auth/client/reset-password/:token`, which redirects to the member app's `/set-password?token=`. That page sends **`POST /api/v1/public/members/set-password`** `{ token, password }` → `{ token }`: the password is set and the member signed in at this studio. 400 `invalid_token` (used or expired) / `password_too_short` / `password_too_long`; 403 `client_blocked`.
5. "Forgot password": **`POST /api/v1/public/members/password-link`** `{ email }` → `{ next: 'link_sent' }`, the same link.
6. Change password: `POST /api/v1/auth/client/change-password` `{ currentPassword, newPassword }` (the pool's own). Refused to an impersonated session, 403 `impersonation_forbidden`.

Link requests and password attempts are limited per address and per email (`services/auth/rate-limit.ts`); over budget is 429. The pool's `/sign-in/email-otp` and the email-OTP plugin's own password-reset and email-change endpoints are disabled.

An admin adding a member (`POST /portal/admin/clients`) writes the same two rows in one transaction, with no password; the member's first sign-in mails them the link, and an admin can send it from the member detail (`POST /portal/admin/clients/:id/send-set-password`). Blocking deletes the member's sessions **at that studio only** and restoring lets them sign in again — a block is one studio's decision, and the same auth user may be a member elsewhere.

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
