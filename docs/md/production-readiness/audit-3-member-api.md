# Audit 3 — Member-facing API (`/api/v1/me/*`, `/api/v1/public/*`, top-level route helpers)

Read-only audit. Every finding cites `file:line` under `be/src/`. Nothing was run, measured or modified.
CONFIRMED = the code proves it. SUSPECTED = needs a measurement, an EXPLAIN, or a fact from another slice.

Target load reasoned about: ~100 concurrent members + ~10 admins, several tenants, one backend process.

---

## (a) How it works

**Request envelope.** Every tenant-scoped request runs inside ONE Postgres transaction opened by the tenant middleware: `resolveTenant` calls `withTenant(tenantId, () => next())` (`middleware/tenant.ts:102`), which does `BEGIN`, `set_config('app.tenant_id', …, true)` and then the whole handler chain (`db/index.ts:58-85`). The shared `db` handle is a proxy onto that transaction (`db/index.ts:147-157`), so:

- a request pins one pooled connection from first middleware to response, including any Stripe / R2 / logo call made inside the handler (acknowledged in the comment at `db/index.ts:51-56`);
- a service's `db.transaction(...)` is only a SAVEPOINT (`db/index.ts:231-244`). Row locks taken inside it are held until the outer request COMMIT, not until the savepoint returns;
- `Promise.all([...queries])` inside a request does not run in parallel: all statements share one connection (it pipelines at best);
- work registered with `afterCommit` runs after COMMIT, each piece in a new `withTenant` transaction, and is awaited before the HTTP response is released (`db/index.ts:83`, `120-130`).

The pool is `postgres(url)` with no options (`db/index.ts:27`); the URL is built without query parameters (`db/url.ts:25-35`), so postgres.js's default of 10 connections applies unless `DATABASE_APP_URL` is set by hand with `?max=`. (Pool auditor owns this; it is the multiplier behind several findings here.)

**Member auth per request** (`middleware/client-auth.ts:36-67`): Better Auth `getSession` for the bearer token, then `SELECT * FROM clients` for the member row. Baseline before any handler work is therefore about 5-6 round trips: BEGIN, set_config, session lookup(s), clients row, COMMIT.

**Class booking** (`services/bookings/book.ts:118-187`): `SELECT … FOR UPDATE` on the class row, already-booked check, seat count, per-member advisory lock, clash check (3 queries), expiry sweep, `FOR UPDATE` on the member's packages, booking insert, ledger debit (lock, voided check, update, movement insert), waitlist settle. Confirmation email via `afterCommit`.

**Cancel** (`services/bookings/cancel.ts:118-363`): wrapped in `retryingTransaction` (4 attempts on deadlock/serialization). Locks class, booking, member row, the waitlist head's member-time and packages, refunds, then `promoteFromWaitlist` books the head of the line through the same `payAndBook`.

**Waitlist join** (`services/waitlist/entries.ts:42-114`): under the class lock; partial unique index `waitlist_entries_one_waiting_unique` as a backstop.

**Checkout** (`routes/client/purchases.ts:208-419` → `services/billing/checkout-session.ts:321-406`): quote in a service, insert an `open` `purchases` row, ensure a Stripe Customer, create a Stripe Checkout Session, store its id. Grant happens in the webhook (or `POST /checkout/sync-session`), idempotent per purchase id (`bookings_purchase_unique`, `client_packages_purchase_unique`).

**Public reads** recompute from Postgres on every request; only `GET /public/tenants/by-slug/:slug` sets `Cache-Control` and has an in-process cache.

---

## (b) Endpoint inventory

"Q" = SQL statements issued by the handler + service on the common path, excluding the per-request baseline (BEGIN, set_config, session lookup, clients row, COMMIT ≈ 5-6 round trips for `/me/*`; BEGIN, set_config, COMMIT for `/public/*`). Counts are from reading the code, not from a trace.

### `/api/v1/me/*` (member, authenticated)

| Method + path | Service fn | Q | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| GET `/me` | none (`clientRow` from middleware) | 0 | n/a | 9 fields | OK |
| PATCH `/me` | `editOwnProfile` | 2-3 | n/a | route schema has no max (service caps name at 160) | OK |
| POST `/me/photo` | `setProfilePicture` | 2-3 + R2 put | 5 MB body limit | stored as uploaded, no resize | F22 |
| DELETE `/me/photo` | `removeProfilePicture` | 2-3 | n/a | | OK |
| PATCH `/me/display-prefs` | `setDisplayPrefs` | 1-2 | n/a | | OK |
| GET `/me/packages` | `listClientPackages` + `getClientEntitlements` | 3 | No: all packages ever | `client_packages` read twice | F09, F17 |
| GET `/me/packages/:id/credit-history` | `creditHistory` | 2 | No: every movement | | F09 |
| GET `/me/cards` | `listSavedCards` | 1-2 + Stripe call | limit 100 | Stripe round trip inside the request tx, no cache | F02 |
| DELETE `/me/cards/:id` | `removeSavedCard` | 1-2 + 2 Stripe calls | n/a | | F02 |
| GET `/me/classes` | `listClassCards` + `myBookedClassIds` + `myClashes` | ~11-12 | Window only: 28 days default, 90 max, no LIMIT | location address/gmaps and instructor repeated per card; `instructor_ids` + `main_instructor_id` + `supporting_instructor_ids` duplicated | F08 |
| GET `/me/classes/:id` | `getClassDetail` + `memberPackagesForClass` + `myClashes` | ~13-16 | n/a | class row read twice, policy twice, rule twice; `waitlist.my_entry` always null | F17, F26 |
| GET `/me/workshops` | `listActiveWorkshopCards` | ~7-8 | No: every `active` workshop | `description_html` in every card; `select *` on 4 tables | F09, F18 |
| GET `/me/workshops/:id` | `getWorkshopDetailPayload` | ~10 | n/a | no lifecycle check | F26 |
| GET `/me/workshop-bookings` | `listMyWorkshopBookings` | 3 | No | qr_token/code for every past booking | F09 |
| GET `/me/class-packages` | `listClassPackages` + promos + entitlements | 4 | catalogue-sized | promotions filtered in JS | F07, F18 |
| GET `/me/pt-packages` | `listPtPackages` + promos | 2 | catalogue-sized | | F07 |
| GET `/me/corporate-packages` | `listCorporatePackages` | 1 | catalogue-sized | | F07 |
| GET `/me/corporate-requests` | `listCorporateRequestsForClient` | 1+ | No | | F09 |
| GET `/me/bookings/upcoming` | `listClassBookings('upcoming')` | 2 | Naturally small | 6-table join | OK |
| GET `/me/bookings/past` | `listClassBookings('past')` | 2 | No: whole history | qr_token + code on every past row | F09 |
| GET `/me/bookings/cancelled` | `listCancelledClassBookings` | 2 | No | | F09 |
| GET `/me/bookings/attendance` | `memberAttendance` | 5 | Lifetime aggregate every call | | F19 |
| GET `/me/bookings/:id` | `getClassBookingDetail` + `previewMemberClassCancel` | 4 | n/a | policy row read twice | F17 |
| POST `/me/bookings/class` | `bookClass` | ~17-20 under the class lock, then email after commit | n/a | | F01, F05, F13 |
| DELETE `/me/bookings/:id` | `cancelBooking` | ~14 + ~12-14 per promoted member + ~8 per skipped | n/a | | F14 |
| GET `/me/pt-sessions` | `listClientPtRequests` | 5-6 | No | qr_token/code per request | F09 |
| GET `/me/pt-sessions/partner-lookup` | `lookupPartnerByEmail` | 1 | n/a | `lower(email)` predicate; member directory oracle | F23 |
| POST `/me/pt-sessions/request` | `submitPtRequest` | ~12 | `slots` array uncapped | no dedupe | F12 |
| POST `/me/pt-sessions/:id/cancel` | `cancelPtRequest` | ~10-20 | n/a | `:id` not validated as UUID | F21 |
| POST `/me/checkout/validate-promo` | `describeProduct` + `previewPromoCode` | 5-6 | reads every redemption of the code | `code` has no max length | F15, F20 |
| POST `/me/checkout/package` | `billToFor` + `beginPackageCheckout` + `createCheckoutSession` | ~12-15 + 1-2 Stripe calls | n/a | no idempotency | F02, F03, F11 |
| POST `/me/checkout/cross-location/quote` | `quoteCrossLocationAddOn` | 2-3 | n/a | | OK |
| POST `/me/checkout/cross-location` | `beginCrossLocationCheckout` + `createCheckoutSession` | ~8 + Stripe | n/a | | F02, F11 |
| POST `/me/checkout/merch` | `beginMerchCheckout` + `createCheckoutSession` | ~8 + Stripe | n/a | | F02, F11 |
| POST `/me/checkout/workshop` | `beginWorkshopCheckout` + `createCheckoutSession` | ~15-20 + Stripe | n/a | capacity check without a lock | F02, F04, F11 |
| GET `/me/checkout/options` | `partPaymentEnabled` | 1 | n/a | static per tenant | F07 |
| GET `/me/purchases/open` | `listOpenPurchases` | 1-3 | small | `select *` | OK |
| POST `/me/purchases/:id/resume` | `resumePurchaseCheckout` | ~8 + 2-3 Stripe calls under a row lock | n/a | | F10 |
| GET `/me/merch-orders` | `listMerchOrders` | 1 | No | `select *` | F09 |
| POST `/me/checkout/sync-session` | Stripe retrieve + `handleStripeEvent` + `checkoutOutcome` | Stripe call + full webhook path | n/a | logic lives in the route | F02, F25 |
| GET `/me/receipts` | `listMemberReceipts` | 2-3 | Yes: page ≤100, default 20 | full rows fetched for a 6-field summary | F16 |
| GET `/me/receipts/:id` | `memberReceipt` + `receiptStudio` | 2 | n/a | JSON plus a full rendered HTML page of the same data | F16 |
| GET `/me/receipts/:id/pdf` | `memberReceipt` + `receiptPdf` | 2 + logo fetch + pdfkit | n/a | `no-store`; logo fetched every time | F16 |
| GET/POST/PATCH/DELETE `/me/billing-details[/:id[/default]]` | `billing-details.ts` | 1-5 | Yes: 3 rows per member | service-level length caps | OK |
| GET `/me/referral` | stub | 0 | n/a | 501 | F29 |
| GET `/me/waitlist` | `listForClient` | 2 | Naturally small | | OK |
| POST `/me/waitlist/classes/:classId` | `join` | ~11-12 under the class lock | n/a | | OK (F05 applies) |
| DELETE `/me/waitlist/:entryId` | `leave` | 3 | n/a | | OK |
| GET `/me/approvals` | `listUnseenApprovals` | 2 | Small | | OK |
| POST `/me/approvals/:kind/:id/seen` | `markApprovalSeen` | 1-2 | n/a | idempotent | OK |

### `/api/v1/public/*` (anonymous)

| Method + path | Service fn | Q | Bounded? | Cache headers | Verdict |
|---|---|---|---|---|---|
| GET `/public/tenants/by-slug/:slug` | `resolveTenantBySlug` | 0-1 (60 s in-process cache) | n/a | `public, max-age=60, swr=300` | OK (F27 for misses) |
| GET `/public/locations` | `listActiveLocations` | 1 | catalogue | none | F07 |
| GET `/public/classes` | `listClassCards` | ~8 | 28-90 day window, no LIMIT | none | F07, F08 |
| GET `/public/classes/:id` | `getClassDetail` | ~8-10 | n/a | none; `:id` unvalidated | F07, F21 |
| GET `/public/merch` | `listMerch` | 1 (`select *`) | catalogue | none | F07 |
| GET `/public/instructors` | `listActiveInstructors` | 1 | catalogue | none | F07 |
| GET `/public/class-types` | `listClassTypes` | 1-2 (`select *` → id, name) | catalogue | none | F07, F18 |
| GET `/public/packages` | class + pt packages + 2 promo reads | 4 | catalogue | none | F07 |
| GET `/public/cancellation-policy` | `readCancellationPolicy` | 1 | n/a | none | F07 |
| GET `/public/pt-booking-config` | `readPtBookingWindow` | 1 | n/a | none | F07 |
| GET `/public/online-payments` | `takesOnlinePayments` | ≥1 (credentials load) | n/a | none | F07 |
| GET `/public/corporate-packages` | `listCorporatePackages` | 1 | catalogue | none | F07 |
| GET `/public/marketing` | `findMarketing` | 1 | n/a | none | F07 |
| GET `/public/maintenance` | inline | 0 | n/a | none | OK |
| GET `/public/referral/by-code/:code` | stub | 0 | n/a | 501 | F29 |
| POST `/public/members/register`, `/sign-in-step`, `/password-link`, `/set-password` | `services/auth/*`, `clients/register` | auth slice | `phone` uncapped | n/a | F20 (rest: auth auditor) |
| GET `/public/staff-invitation`, POST `/staff-invitation/accept` | staff invitations | auth slice | `token`, `password` uncapped | n/a | F20 |
| GET `/public/staff-email-change`, POST `/confirm` | staff email change | auth slice | token ≤512 | n/a | OK |
| POST `/public/staff/sign-in-step` | `staffSignInStep` | auth slice | email only | n/a | OK |

### Top-level `routes/*.ts`

`business-details.ts` (zod schema + serializer, fields ≤5000), `profile-picture.ts` (route factory, body limit 5 MB + 16 KB), `receipt-views.ts` (shared receipt schemas, page size cap 100), `uploaded-file.ts` (multipart guard), `explain-invalid.ts`. No queries of their own. Covered through the endpoints that mount them.

---

## (c) Findings

### P0

#### F01 — Post-commit email is awaited inside the request, holding a second connection in an open transaction, behind an 8-per-second gate with retries — CONFIRMED (mechanism), SUSPECTED (pool size in production)

Evidence:
- `db/index.ts:83` — `withTenant` does `await runAfterCommit(...)` before returning, and the tenant middleware awaits `withTenant` (`middleware/tenant.ts:102`), so the HTTP response is not released until every after-commit job finishes.
- `db/index.ts:120-130` — each job runs inside a fresh `withTenant(...)`, i.e. a new transaction on a second pooled connection that stays open for the job's whole duration.
- `services/bookings/book.ts:185` — every class booking registers `sendClassBookingEmail`. Same pattern: `services/bookings/cancel.ts:127-133`, `services/pt-sessions/request.ts:220`, `services/pt-sessions/cancel.ts:123-126`, `services/workshops/book.ts:394`, `services/packages/purchase.ts:647`, `725`.
- `services/notifications/send.ts:231-272` — the job inserts an `email_log` row, then `await sendMail(...)`, then updates the row, all in that open transaction.
- `lib/send-gate.ts:41-46` — sends are paced at 8 per second process-wide, retried up to 5 times with backoff up to 30 s, and "callers still await their send" (`lib/send-gate.ts:27`).
- `db/index.ts:27` — pool created with defaults (10 connections in postgres.js).

At 100 members + 10 admins: 30 members book the same class at release. The bookings themselves serialise correctly, but they queue 30 emails through an 8/s gate. Each waiting email holds an idle-in-transaction connection and its member's HTTP response. The last booker waits about 4 s for a response that was decided long before; for those seconds most or all of a 10-connection pool is occupied by transactions waiting on mail, so every other request on every tenant (timetable reads, admin screens, webhooks) queues behind them. If Resend is slow or rate-limiting, the retry/backoff path (up to 5 attempts, 30 s cap) turns a mail incident into an API outage. A whole-class cancel or a waitlist promotion batch multiplies the effect.

Fix:
1. Do not await after-commit work in the request path. Respond first, then run it (fire-and-forget with error reporting), or better, write an outbox row inside the request transaction and have a worker send it.
2. Never hold a transaction across `sendMail`. Read what the email needs and insert the `queued` log row in one short transaction, release the connection, call Resend, then update the log row in a second short transaction.
3. Set the pool size explicitly and size it for the workload (pool auditor).

---

### P1

#### F02 — Stripe calls run inside the request transaction: a pooled connection (and any row locks) is held for up to 8 s per call — CONFIRMED

Evidence:
- `services/billing/checkout-session.ts:357-404` — `openPurchase` insert, `providerCustomerFor` (may call `stripe.customers.create`, `services/billing/payment-customers.ts:166-175`), then `stripe.checkout.sessions.create` (`:388-403`), then `attachCheckoutSession`, all in the request transaction. Used by `routes/client/purchases.ts:222`, `257`, `301`, `329`, `401`.
- `routes/client/purchases.ts:431-433` — `checkout.sessions.retrieve`, then the full webhook grant path `handleStripeEvent` (`:453-460`) in the same request.
- `services/billing/payment-customers.ts:257-264` — `GET /me/cards` lists payment methods at Stripe on every call, uncached; `:342-355` two Stripe calls for card removal.
- `lib/outbound.ts:33-34` — Stripe deadline is 8 000 ms per call.

At target load: checkout requests are few, but each pins one of (by default) 10 connections for a Stripe round trip of typically 300-800 ms and up to 8 s (16 s+ when a Customer must be created first). The checkout page calling `GET /me/cards` adds another per visit. A Stripe slowdown therefore removes connections from the pool for seconds at a time and stalls unrelated requests. The per-member checkout limiter (`middleware/checkout-rate-limit.ts:10`, 10/min) caps one member, not the fleet.

Fix: split checkout into three phases: (1) short transaction: quote, insert the `open` purchase, commit; (2) no transaction: Stripe calls; (3) short transaction: attach the session id. For `GET /me/cards`, read the customer id in a short transaction, call Stripe outside it, and cache the result per member for a minute or so. Requires a way for a route to run outside the request-wide transaction (e.g. an opt-out list in `resolveTenant` with explicit `withTenant` blocks in the service).

#### F03 — A promo code's row lock is held across the Stripe calls of the checkout that uses it — CONFIRMED

Evidence:
- `services/packages/promo-redemption.ts:240-243` → `readCode(tx, …, true)` → `:98` `SELECT … FOR UPDATE` on the `promo_codes` row. `db.transaction` here is a savepoint (`db/index.ts:231-244`), so the lock lives until the request COMMIT.
- The same request then runs `createCheckoutSession` with its Stripe calls (`services/billing/checkout-session.ts:373-403`), invoked after `beginPackageCheckout`/`beginWorkshopCheckout` returns (`routes/client/purchases.ts:239-276`, `390-417`).
- `services/packages/promo-redemption.ts:350-388` — `endEarlierCheckouts` makes up to two more Stripe calls per earlier open checkout while holding the same lock.

At target load: a studio emails one promo code to its members and 20-30 of them check out in the same minute. Every checkout with that code queues on one row lock, each holder keeping it for a full Stripe round trip. Thirty checkouts at ~0.5 s each is a 15 s queue; every waiter is a blocked request holding a pool connection, so the pool is exhausted and the whole API stalls. Under Stripe slowness the queue grows to minutes and requests time out after their purchase row was already written.

Fix: commit the hold before calling Stripe (falls out of F02's three-phase split). The hold is already a durable row with `held_until`, so nothing needs the lock once it is written. Make `endEarlierCheckouts` a pre-step outside the lock, or do it after commit.

#### F04 — Workshop places can be oversold: capacity is checked without a lock and not re-checked at grant — CONFIRMED

Evidence:
- `services/workshops/book.ts:99-136` — `assertWorkshopBookable` reads a count and compares; no `FOR UPDATE` on the workshop, its days, or anything shared between two members.
- Paid path: the check runs at checkout start (`services/workshops/checkout.ts:87`); the booking is inserted later by the webhook via `bookWorkshopPaid` → `insertWorkshopBooking` (`services/workshops/book.ts:181-246`, `270-296`) with no capacity check. The code says so itself: `services/billing/webhook-handler.ts:982-991` ("capacity is checked when checkout starts, and `bookWorkshopPaid` deliberately does not re-check it").
- Free path: `services/workshops/book.ts:343-354` takes only the per-member advisory lock (`lockMemberTime`) before `assertWorkshopBookable`; two different members are not serialised against each other under READ COMMITTED.
- The only lock on the workshop is `FOR KEY SHARE` (`services/workshops/tiers.ts:207-213`), which does not conflict between bookers.

At target load: a workshop with 2 places left and 10 interested members. All 10 pass the check, all 10 are sent to Stripe, all 10 pay, all 10 are booked. The gap is not "seconds": it is however long each member spends on the Stripe page (sessions live up to 24 h), and weeks for part payments. Result: silent overbooking with money taken.

Fix: take a `FOR UPDATE` lock on the workshop row (or its day rows, in id order) around count + insert in both `bookWorkshopFree` and the webhook grant; on a full workshop at grant time, do not book and flag the purchase for automatic refund. If the product wants a seat held during payment, count open, unexpired checkouts as provisional places (the query already exists: `payableSalesOfWorkshopTier`, `services/billing/open-purchases.ts:500-520`).

#### F05 — Class release: correct, but every waiter on the class lock occupies a pooled connection, and the critical section is ~17-20 sequential round trips — CONFIRMED (structure), SUSPECTED (timings)

Evidence:
- Lock: `services/bookings/book.ts:299-319` (`lockClass`, `FOR UPDATE`), taken at `:130`.
- Statements under the lock on the common path: `holdsSeat` (`:141`), `countSeats` (`:144`), `lockMemberTime` — two round trips, a `hashtext` select then one `pg_advisory_xact_lock` per key (`services/bookings/member-time.ts:157-164`), `heldWindows` — three sequential selects (`member-time.ts:74-128`), `sweepExpired` update (`services/packages/activation.ts:34-47`), `candidatePackages … FOR UPDATE` (`book.ts:486`), `readClassRule` (`:493`), optional `activatePackage`, booking insert (`:517-531`), `debitCredits` — select for update, `isVoided`, update, movement insert (`services/packages/ledger.ts:107-172`), `settleWaitingOnBooking` (`book.ts:171`), savepoint release, then the outer COMMIT.
- The lock is released at request COMMIT, not at savepoint end (see (a)).

At target load: 30 members press Book at the same instant. Capacity is safe: bookers are strictly serialised, the count is read under the lock, and the 31st gets `class_full`. No deadlock is possible among bookers of one class (single entry lock, then per-member locks). But each of the 30 requests has already taken a pool connection (BEGIN, session and member reads) before blocking on the lock. With a 10-connection pool, 1 holder + 9 waiters own the entire pool and the other 20 bookers, plus every other request on the platform, wait in the driver's queue. Queue drain time is 30 × (lock hold time). At ~1 ms per round trip that is well under a second; with the database on another host, or with RLS policy overhead per statement, it is several seconds of total API stall. There is no `lock_timeout` or `statement_timeout` anywhere in `be/src` (grep found none), so a stuck holder blocks the class and the pool indefinitely.

Fix:
1. Shorten the critical section: fold `lockMemberTime` into one statement (`select pg_advisory_xact_lock(hashtext(...))`), make `heldWindows` one `UNION ALL` query, merge `holdsSeat` + `countSeats` into one aggregate, and return what `debitCredits` re-reads (the package row is already locked and in hand at `book.ts:486`; `isVoided` can be joined into `candidatePackages`).
2. Do the cheap rejections before taking the class lock (class exists/active/not started, already booked) so losers do not queue.
3. Set `lock_timeout` (e.g. 3-5 s) for the booking transaction and map the timeout to a retryable 409/503.
4. Size the pool explicitly (pool auditor), and see F01 for the after-commit email that follows each booking.

#### F06 — Rate limits key on IP address, never on the member; public budget is 100 requests/min per address — CONFIRMED (code), SUSPECTED (impact depends on client call volume)

Evidence:
- `app.ts:97-102` — `authedLimiter` keys on `c.get('clientId') ?? c.get('staffUserId') ?? x-forwarded-for ?? 'global'`, but it is mounted at `app.ts:120`, before the client routes and their `clientAuth` (`app.ts:201`, `routes/client/index.ts:19`), so `clientId` is never set when the key is computed. `middleware/checkout-rate-limit.ts:21-24` states this directly ("the app's limiters run before any auth and only ever see the address").
- `app.ts:92-96`, `117-119` — every `/api/v1/public/*` request other than the tenant lookup shares 100/min per `x-forwarded-for`, falling back to one `'global'` bucket when the header is absent.

At target load: members in one studio share the studio's wifi address, and mobile carriers put many users behind one NAT. Twenty members opening the app in the lobby before class share 300 authenticated and 100 public requests per minute. A member-app page typically fans out to several public reads (locations, instructors, class types, classes, policy, online-payments), so 100/min is roughly 15-20 page loads per minute for the whole building, after which everyone gets 429. Any server-side call without `x-forwarded-for` lands in the single `'global'` bucket shared by all tenants.

Fix: mount the authed limiter after authentication (inside `routes/client/index.ts`, as `checkoutRateLimit` already is) and key it on `tenantId:clientId`; keep a much larger per-IP ceiling in front as abuse protection only. Raise the public budget and make public reads cacheable (F07) so they rarely reach the limiter. (Owner: middleware auditor; listed here because it throttles this slice's endpoints.)

#### F07 — Tenant-static reads are recomputed from Postgres on every request; no `Cache-Control`/`ETag` on any catalogue endpoint — CONFIRMED

Evidence:
- The only cache headers in the slice are `routes/public/tenants.ts:23`, `54`, `65` and the receipt PDF's `no-store` (`routes/receipt-views.ts:99`). A grep of `be/src` for `Cache-Control|etag|compress` finds nothing else (no response compression in the app either; server auditor to confirm whether the proxy compresses).
- Uncached, per request, each inside its own transaction: `routes/public/catalog.ts:61-165` (locations, instructors, class types, packages, cancellation policy, PT booking config, online-payments, corporate packages, merch), `routes/public/marketing.ts:9-11`, `routes/client/purchases.ts:345-352` (`checkout/options`), `routes/client/catalog.ts:145-203`.
- The cancellation policy row is read from the database by `readCancellationPolicy` (`services/policy/evaluate-cancellation.ts:59-73`) through `classCancelWindow` on nearly every member request and often several times within one: twice in `listClassCards` (`services/waitlist/line.ts:116` via `waitlistSummaries`, and `services/schedule/client-catalog.ts:204`), twice in `getClassDetail` (`client-catalog.ts:340`, `342`), twice in `GET /bookings/:id` (`services/bookings/list.ts:253`, `services/policy/evaluate-cancellation.ts:109`), again in `lineState`, `join`, `promotableLine`, `staffCancelInTime`.
- Email path: `emailEnabled`, the template row (`select *`), and `tenantMailIdentity` are read per email (`services/notifications/send.ts:120-141`).

At target load: 100 members each trigger several of these reads per page view. Each is cheap alone, but each costs a pool checkout, BEGIN, set_config, the query, and COMMIT (4+ round trips for one row of data that changes a few times a year), and they compete for the same small pool as bookings.

Fix:
1. Add `Cache-Control: public, max-age=60, stale-while-revalidate=300` (plus `Vary: X-Tenant-Slug, Origin`) and an `ETag` to the anonymous catalogue reads that carry no member data: locations, instructors, class types, packages, corporate packages, merch, cancellation policy, PT booking config, online-payments, marketing. Not `/public/classes` as-is (seat availability changes) unless a short max-age (5-10 s) is acceptable.
2. Add a per-tenant in-process cache with a short TTL and write-through invalidation for the policy row, PT booking config, cross-location rate, part-payment flag and email switches, in the style of `services/feature-flags.ts:13-37` and `services/tenants/tenants.ts:64-89`.
3. Consider one bootstrap endpoint for the member app instead of 6-8 separate static reads.

#### F08 — Class timetable (`GET /me/classes`, `GET /public/classes`) is unpaginated, defaults to 28 days, allows 90, and costs ~11-12 queries per call — CONFIRMED

Evidence:
- `services/schedule/client-catalog.ts:112-119` — default window 28 days, cap 90 days, no LIMIT.
- `:151-179` main 5-table join; then `waitlistSummaries` (policy + live waiting rows for every class id, `services/waitlist/line.ts:107-136`), rooms (`:185-191`), seat counts (`:194-198`), rosters (`:199-202`), policy again (`:204`); the member route adds `myBookedClassIds` and `myClashes` (three more queries, `routes/client/catalog.ts:97-103`). Each follow-up passes the full id list as an `IN (...)` of several hundred UUIDs.
- Payload per card (`:206-230`): nested `location` with `address` and `gmaps_url` repeated on every card, `instructor` with `photo_url` repeated, and three overlapping instructor-id fields. `waitingCounts`-style work is done in JS: all waiting rows are fetched and grouped in memory (`line.ts:117-124`), and `positions(line)` is recomputed per class.

At target load: a studio with two locations and ~15 classes a day returns ~840 cards for the default window, roughly 0.4-0.6 MB of JSON, and about 2.5 MB at 90 days, rebuilt from scratch per member per visit. With 100 members browsing, this endpoint is the dominant read load and the largest response on the platform.

Fix: default to the visible range (one day or one week) and cap at ~14 days; require the client to page by date. Move `locations`, `instructors` and `rooms` to top-level lookup maps keyed by id (or rely on the already-separate `/public/locations` and `/public/instructors`). Drop the duplicated id fields. Compute waiting counts and "my position" in SQL (`count(*) … group by class_id`, a window function for the member's own row) instead of fetching every waiting row. Fold the room into the main join.

#### F09 — Member history lists are unbounded: no LIMIT, no cursor — CONFIRMED

Evidence:
- `services/bookings/list.ts:154-164` (`/bookings/past`: every non-cancelled past class booking, 6-table join), `:180-206` (`/bookings/cancelled`).
- `services/pt-sessions/list.ts:190-251` (`/pt-sessions`: every request ever, plus 4-5 follow-up queries over all their ids).
- `services/workshops/my-bookings.ts:47-77` (`/workshop-bookings`), `services/catalog/merch-orders.ts:148-156` (`/merch-orders`), `services/corporate/requests.ts:261-269` (`/corporate-requests`).
- `services/packages/entitlements.ts:284-323` (`/packages`: all packages ever unless `only_active=1`), `services/packages/credit-history.ts:58-91` (every movement of a package; an Unlimited plan used daily accumulates hundreds).
- `services/workshops/catalog.ts:227-232` (`/workshops`: every workshop whose lifecycle is `active`; nothing in this query excludes workshops whose last day has passed).
- Past and cancelled rows carry `qr_token` and `code` (`routes/client/bookings.ts:35-36`), which a finished booking no longer needs.

At target load: not a day-one problem, a growth one. A member attending 4 classes a week has ~200 past bookings after a year and ~600 after three; the My Bookings page fetches and renders all of them on every visit. Costs rise linearly per member, forever.

Fix: add `limit` (default 20-30, max 100) and a keyset cursor (`starts_at, id`) to every history list; return `next_cursor`. Stop returning `qr_token`/`code` on rows that are no longer checkable. Filter `/workshops` to workshops with a day still to come.

#### F10 — `resumePurchaseCheckout` holds a `purchases` row lock across two or three Stripe calls — CONFIRMED

Evidence: `services/billing/open-purchases.ts:355` (`lockPurchase`, `FOR UPDATE` at `:249-256`), then `expirePredecessor` → `stripe.checkout.sessions.expire` (`:276-281`), `providerCustomerFor` (`:424-431`, may create a Customer at Stripe), `stripe.checkout.sessions.create` (`:435-463`), then `attachCheckoutSession`. The `expire` and `create` calls here are not wrapped in `outbound(...)` (compare `checkout-session.ts:391`), so they get the SDK timeout but not the wrapper's logging/timeout classification.

At target load: the lock is on the row the Stripe webhook must lock to settle a payment for the same purchase. A member who pays and immediately reopens the balance page makes the webhook wait behind up to ~24 s of Stripe calls, with both requests holding pool connections.

Fix: lock, validate and compute the charge in a short transaction; commit; call Stripe; attach the new session id in a second short transaction guarded by a compare-and-set on the previous `checkout_session_id`. Wrap both calls in `outbound`.

---

### P2

#### F11 — Checkout creation is not idempotent: a double click makes two `purchases` rows and two Stripe sessions — CONFIRMED

Evidence: `services/billing/checkout-session.ts:357-371` always inserts a new `open` purchase; `:391-403` calls `checkout.sessions.create` with no idempotency key (the only Stripe idempotency key in the codebase is the refund's, `services/billing/refunds.ts:793`). `services/billing/payment-customers.ts:162-185` reads the stored Customer, and if absent creates one at Stripe with no idempotency key before an `onConflictDoNothing` insert, so two concurrent first checkouts leave an orphan Customer at Stripe.

Impact: orphan `open` purchases accumulate (one per abandoned or duplicated click); a member with two tabs can pay twice for what they meant to buy once. Grants stay idempotent per purchase, so nothing is corrupted.

Fix: accept an `Idempotency-Key` header (or derive one from member + product + a client nonce) and store it on `purchases` under a unique index; return the existing session URL on a repeat. Pass `{ idempotencyKey: 'checkout:' + purchase.id }` to `sessions.create` and `'customer:' + tenantId + ':' + clientId` to `customers.create`.

#### F12 — `POST /me/pt-sessions/request` has no dedupe and an uncapped `slots` array — CONFIRMED

Evidence: `routes/client/pt-sessions.ts:24` (`z.array(slotSchema).min(1)`, no `.max`). `services/pt-sessions/request.ts:119-218` locks the package, debits one session and inserts a request; nothing recognises a repeat of the same submission. A double tap with two or more sessions remaining produces two requests and two debits.

Fix: `.max(10)` (or the product's real limit) on `slots`; reject or return the existing request when the member already has a pending request with the same package, session type and slot set created in the last few seconds, or accept an idempotency key.

#### F13 — Booking is not retried on deadlock, and a booking-code collision surfaces as a 500 — CONFIRMED (code), SUSPECTED (frequency)

Evidence:
- `services/bookings/book.ts:128` uses plain `db.transaction`; cancel and the other multi-lock paths use `retryingTransaction` (`services/bookings/cancel.ts:125`, list at `db/index.ts:167-174`). A booking that Postgres picks as the deadlock victim against a concurrent cancel/promotion for the same member returns a raw 40P01 as a 500.
- `services/bookings/qr.ts:23-39` — the human code is `RT-` plus 6 Crockford characters (32^6 ≈ 1.07 × 10^9 values), unique per tenant across all bookings ever (`db/schema/bookings.ts:109`). No path catches `bookings_code_unique` (grep finds no handler). By the birthday bound a tenant expects its first collision at around 40-50 thousand bookings; when it happens, that booking fails with a 500 after the member's credits were (transactionally) rolled back.

Fix: wrap `bookIntoClass` in `retryingTransaction` (add `'class booking'` to `RetriedOperation`); on `isUniqueViolation(err, 'bookings_code_unique')` regenerate and retry inside a savepoint, as `classPassBookClass` already does for its own unique index (`book.ts:253-258`).

#### F14 — A cancel pays the full cost of waitlist promotion inside the canceller's request, under the class lock — CONFIRMED

Evidence: `services/bookings/cancel.ts:352` → `services/waitlist/promote.ts:59-106`. Each loop iteration runs `countSeats`, `holdsSeat`, a `FOR UPDATE SKIP LOCKED` claim and `payAndBook` (~12 statements); a member who cannot pay or has a clash is skipped after ~8 statements and the loop moves to the next (`:92-95`). `lockPromotionHead` (`:115-127`) re-reads the line first.

Impact: with a 15-deep line where the first several members cannot pay, one member's cancel issues 100+ statements while holding the class lock and its own connection, and its response waits for all of it plus the promotion emails (F01). Bounded by `capacity_waitlist`.

Fix: batch the eligibility read for the line (one query for packages of all waiting members, one for clashes) and decide in memory, then write only for the winner; or enqueue promotion as a post-commit job keyed by class id.

#### F15 — Promo validation loads every redemption row of the code — CONFIRMED

Evidence: `services/packages/promo-redemption.ts:100-119` selects all `promo_code_redemptions` for the code (`select()` with no limit) on every `validate-promo` and every checkout, to derive a count and the member's own row.

Fix: `select count(*) filter (where status in (...))` plus one row for `(promo_code_id, client_id)`.

#### F16 — Receipts: full rows fetched for a summary, detail duplicates its data as rendered HTML, PDF refetches the logo every time — CONFIRMED

Evidence: `services/receipts/read.ts:137-144` (`select()` of whole receipt rows incl. lines/payments/bill-to JSON, mapped to six fields by `receiptSummaryView`, `routes/receipt-views.ts:34-41`; second query for `count()`); `routes/receipt-views.ts:89-91` (detail returns the structured receipt and a complete HTML page of the same content); `services/receipts/pdf.ts:27-30` + `services/receipts/logo.ts:22-60` (logo fetched over HTTP per PDF, 3 s deadline, inside the request transaction; pdfkit renders on the event loop).

Fix: project the summary columns; drop `html` from the JSON (or serve it from its own endpoint); cache the decoded logo per tenant for a few minutes; receipts are immutable once issued, so the PDF can be cached by `(id, refunded_at)`.

#### F17 — Repeated lookups and avoidable sequential round trips — CONFIRMED

- `GET /me/classes/:id`: class row read in `getClassDetail` (`client-catalog.ts:251-280`) and again in `readBookableClass` (`bookings/book.ts:623-638`); class rule read in `namedClassRule` (`client-catalog.ts:343`) and again in `classifyForClass` (`book.ts:660`); policy twice (`client-catalog.ts:340`, `342`); room as a separate query (`:285-291`).
- `GET /me/packages`: `client_packages` read once by `listClientPackages` and again by `getClientEntitlements` (`routes/client/me.ts:138-141`; `entitlements.ts:88-103`, `284-323`).
- `lockMemberTime`: two statements where one would do (`member-time.ts:160-163`).
- `heldWindows`: three sequential selects on every booking, join, promotion and timetable read (`member-time.ts:74-128`); `tierDaysClash` calls it once per workshop day (`workshops/book.ts:41-44`), i.e. 3 × days queries.
- `debitCredits`: re-selects and re-locks a package row the caller just locked, plus a separate `isVoided` join (`packages/ledger.ts:107-131`).
- `Promise.all` over queries (`routes/client/me.ts:138`, `routes/public/catalog.ts:92-108`, `workshops/catalog.ts:108-132`, `attendance.ts:172-220`) gives no parallelism inside the request transaction; it is fine, but nobody should count on it for latency.

Fix: pass already-loaded rows down; merge the pairs above into single statements.

#### F18 — Over-fetching — CONFIRMED

- `middleware/client-auth.ts:55-59`: `SELECT *` on `clients` for every member request (only id, status, deleted_at, tenant_id, email and the profile fields are used).
- `services/workshops/catalog.ts:109-131`, `228-232`, `240-248`: `select()` of whole `workshops`, `workshop_days`, `workshop_tiers`, `workshop_tier_days`, `locations` rows; cards return `description_html` (rich text) for every workshop in the list (`:204`).
- `services/catalog/class-types.ts:16-21` `select()` then `routes/public/catalog.ts:89` keeps `id` and `name`.
- `services/packages/promotions.ts:21-41`: fetches every active promotion of the parent type for the tenant and filters with `parentIds.includes` in JS instead of `inArray` in SQL.
- `services/packages/class-packages.ts:20-23`, `pt-packages.ts:21`: no `ORDER BY`, so catalogue order is whatever the planner returns.

Fix: explicit projections; move the filter into SQL; add a stable order.

#### F19 — Attendance summary rescans the member's entire attended history on every call — CONFIRMED

Evidence: `services/bookings/attendance.ts:149-161` aggregates all attended class and PT bookings (two joins, `UNION ALL`, group by day/hour/kind) regardless of the requested period, then four more queries (`:172-220`).

Fix: the lifetime numbers (`lifetime.attended`, `since`, `last_attended_at`, streak) change only at check-in; compute them on write or cache per member for minutes. Restrict the main aggregate to the plan window plus the previous period.

#### F20 — No global request-body limit and several uncapped string inputs — CONFIRMED

Evidence: `bodyLimit` appears only on the three upload routes (grep: `routes/profile-picture.ts:26`, `routes/portal/admin/merch.ts:87`, `routes/portal/leave.ts:109`); `app.ts` mounts none, so JSON bodies of any size are buffered and parsed. Uncapped fields: `promo_code` (`routes/client/purchases.ts:92`, `147`), `code` (`:131`), `session_id` (`:423`), `phone` at registration (`routes/public/members.ts:59`), invitation `token` and `password` (`routes/public/staff-invitations.ts:25`, `33-34`), `name`/`phone` on `PATCH /me` at the route (`routes/client/me.ts:92-93`; the service caps name), billing-details text at the route (`routes/client/billing-details.ts:43-56`; the service caps them, `services/billing-details/billing-details.ts:54-61`).

Fix: a global `bodyLimit` (e.g. 100 KB) in `app.ts` for JSON routes; `.max()` on every free-text zod string.

#### F21 — Path ids not validated as UUIDs reach Postgres — CONFIRMED (missing validation), SUSPECTED (500 response)

Evidence: `routes/public/catalog.ts:70-72` (`c.req.param('id')` passed straight to `getClassDetail`), `routes/client/pt-sessions.ts:96-98`. A grep for `22P02`/`invalid input syntax` in `be/src` finds no mapping, so a malformed id most likely becomes a 500 and an error report rather than a 404. The public one is reachable anonymously.

Fix: `zValidator('param', z.object({ id: z.string().uuid() }))` on both, as the sibling routes do.

#### F22 — Profile pictures are stored exactly as uploaded (up to 5 MB) and uploaded to R2 inside the request transaction — CONFIRMED

Evidence: `services/profile-pictures/pictures.ts:25`, `30-64`: type is taken from the client-declared content type, bytes are put to R2 unchanged (`:53`, 8 s storage deadline), then the row is updated. Instructor photos from this path are embedded in every timetable card (`client-catalog.ts:214`).

Fix: decode and re-encode server-side to a bounded size (e.g. 512 px WebP), which also validates the content; do the R2 put outside the transaction.

#### F23 — `GET /me/pt-sessions/partner-lookup` is an unthrottled member-directory oracle on a non-indexable predicate — CONFIRMED (code), SUSPECTED (index)

Evidence: `services/pt-sessions/list.ts:698-720` returns `found`, the member's id and name for any email at the studio; predicate is `lower(email) = …`. Only the general limiter applies (F06). The same predicate is at `services/pt-sessions/request.ts:329`.

Fix: a small dedicated per-member budget (e.g. 10/min); index auditor to confirm an expression index on `(tenant_id, lower(email))`.

---

### P3

- **F24 — Database errors caught and swallowed inside the request transaction — SUSPECTED.** `services/billing/payment-customers.ts:155-193` (`providerCustomerFor`) and `:114-125` (`forgetStaleCustomer`) catch everything, including a failed SQL statement. Inside the request transaction a failed statement leaves the transaction aborted, and postgres.js rethrows it when the scope ends (see the comment at `db/index.ts:222-229`), so "carry on without a Customer" cannot work for a DB failure; the checkout fails later with a less useful error. Wrap the DB part in a savepoint (`db.transaction`) so the catch is real.
- **F25 — Business logic in a route file.** `routes/client/purchases.ts:423-474` talks to Stripe, compares metadata, and calls the webhook handler through a per-request dynamic `import()` (`:447`). Violates the repo convention (routes do auth → zod → service). Move to `services/billing/`.
- **F26 — Two read-path correctness nits found while tracing — CONFIRMED.** `getClassDetail` passes `null` as the client to `waitlistSummaries` (`services/schedule/client-catalog.ts:340`), so `waitlist.my_entry` is always null on `GET /me/classes/:id` even when the member is in the line (the list endpoint passes the client, `:180`). `getWorkshopDetailPayload` does not filter on `lifecycle` (`services/workshops/catalog.ts:284-289`), so a non-active workshop with tiers is readable by id through `GET /me/workshops/:id`.
- **F27 — Unknown slugs are not negatively cached.** `services/tenants/tenants.ts:132-133` returns `null` without caching, then `routes/public/tenants.ts:63` runs a second lookup; a flood of invalid slugs costs two queries each (limiter: 6 000/min per IP, `app.ts:111-115`).
- **F28 — No database-level uniqueness for "one confirmed booking per member per class".** `db/schema/bookings.ts:108-119` has unique indexes for qr token, code, purchase and ClassPass reservation only; the rule rests entirely on the class row lock (`book.ts:141`). A partial unique index `(tenant_id, class_id, client_id) where state = 'confirmed'` would make any future path that forgets the lock fail loudly. Index auditor to weigh in.
- **F29 — Stub endpoints mounted in production.** `routes/client/referral.ts:3` and `routes/public/referral.ts:3-5` answer 501 with a `todo` body. Remove until built.
- **F30 — Trial-eligibility race relies on a unique index with no friendly mapping — SUSPECTED.** `services/packages/purchase.ts:664-676` checks then grants; two concurrent free-trial checkouts hit `client_packages_trial_unique_per_client` (`db/schema/packages.ts:441`) and the loser likely gets a 500 instead of `trial_already_used`.

---

## (d) Checked and fine

- **Class capacity is race-safe.** Count and insert happen under `SELECT … FOR UPDATE` on the class row (`bookings/book.ts:130-145`, `299-319`); a 31st booker gets `class_full`. Staff, ClassPass and waitlist promotion all go through the same lock and `payAndBook`.
- **No double-spend of credits.** The member's package rows are locked `FOR UPDATE` before selection (`book.ts:486`), the ledger re-locks and refuses an overdraw (`packages/ledger.ts:107-148`), and the booking insert rolls back with a refused debit. Double-click on Book: the second request waits on the class lock and gets `already_booked` (`book.ts:141`).
- **Two bookings for one member at overlapping times** are serialised by a transaction-scoped advisory lock taken in sorted order (`bookings/member-time.ts:157-164`).
- **Cancel** retries on deadlock/serialization failure with jittered backoff and drops the aborted attempt's emails (`db/index.ts:197-213`, `231-244`); double cancel gets `not_cancellable` under the booking row lock (`bookings/cancel.ts:155-190`). Lock order (class → booking → member → promotion head's time and packages → own package) is consistent with booking's (class → member time → packages).
- **Waitlist join** runs under the class lock, checks already-booked/already-waiting/full/cap there, uses `clock_timestamp()` so lock waiters cannot jump the line (`waitlist/entries.ts:101-109`), and has a partial unique index as backstop (`db/schema/bookings.ts:233-235`). Promotion claims the entry with `FOR UPDATE SKIP LOCKED` and books once (`waitlist/promote.ts:72-104`).
- **Paid grants are idempotent** per purchase: `bookings_purchase_unique` with a handled conflict (`workshops/book.ts:188-246`), `client_packages_purchase_unique`, merch `onConflictDoNothing` (`catalog/merch-orders.ts:131`). The webhook and `sync-session` racing each other is safe.
- **Refunds to Stripe** carry an idempotency key (`billing/refunds.ts:793`); emails carry one per log row (`notifications/send.ts:257`).
- **Stripe SDK** has an 8 s timeout and zero automatic retries (`lib/stripe.ts:56-57`), so retries cannot amplify load.
- **Email is not sent while the booking's locks are held**: it is registered with `afterCommit` (the problem is what happens after commit, F01).
- **Receipts list** is paginated with a page-size cap of 100 (`routes/receipt-views.ts:21-30`).
- **Billing details** are capped at 3 per member under a member-row lock, with service-side length limits (`billing-details/billing-details.ts:31`, `54-61`, `176-200`).
- **Tenant resolution** is cached in-process for 60 s (`tenants/tenants.ts:64-136`) and the tenant-lookup endpoint sets `Cache-Control`; feature flags are an in-memory map (`feature-flags.ts:13-37`).
- **Checkout has its own per-member limiter** keyed on tenant + member, mounted after auth (`middleware/checkout-rate-limit.ts:26-34`, `routes/client/index.ts:21`).
- **Member-scoped reads filter on `tenant_id` and `client_id` explicitly** in addition to RLS in every list traced (`bookings/list.ts`, `pt-sessions/list.ts`, `workshops/my-bookings.ts`, `receipts/read.ts`, `billing-details.ts`, `waitlist/line.ts`).
- **Upload routes** have body limits and a multipart guard (`routes/profile-picture.ts:26-29`, `routes/uploaded-file.ts:32-45`).
- **`upcoming` bookings, waitlist list, approvals, open purchases** are naturally small and bounded by their predicates.

## Cross-slice notes (for other auditors)

- Pool: `postgres(url)` with defaults (`db/index.ts:27`); no `statement_timeout`, `lock_timeout` or `idle_in_transaction_session_timeout` found in `be/src`. F01, F02, F03, F05 all scale inversely with pool size.
- Indexes worth confirming: `bookings (tenant_id, client_id, kind, state)`, `bookings (tenant_id, class_id, state)`, `cancellations (tenant_id, client_id, source, cancelled_at)` (cap count, `policy/evaluate-cancellation.ts:117-127`), `credit_movements (tenant_id, client_package_id, created_at)`, `clients (tenant_id, lower(email))`, `purchases` on `metadata->>'promo_code_id'` and `metadata->>'workshop_tier_id'` (`promo-redemption.ts:344`, `open-purchases.ts:516`), `promotions (tenant_id, parent_type, status, starts_at, ends_at)`. Several joins in `bookings/list.ts:157-162` join on `id` alone and rely on RLS for the tenant predicate.
- Mail: `lib/send-gate.ts:44-46` hard-codes Resend Free quotas (100/day, 3 000/month) as warning thresholds; `email_log` stores the full rendered HTML of every email (`notifications/send.ts:239-240`).
- Auth: Better Auth `getSession` runs on every member request (`middleware/client-auth.ts:46`); its query count and any session-refresh write were not traced here.
