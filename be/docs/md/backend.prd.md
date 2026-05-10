# Yoga Sadhana — Backend PRD

**Status:** v1 scope (2026-05-07)
**Owner:** Teeko (Christopher Kwek)
**Companion doc:** [`../../../booking-system/docs/md/prd.md`](../../../booking-system/docs/md/prd.md) (product PRD — source of truth for business logic)

---

## 1. Overview

### 1.1 Purpose

This document defines the backend architecture, API contract, data schema, and service boundaries for the Yoga Sadhana booking system. It is the implementation spec for the Node.js REST API that serves both `fe-client` and `fe-admin`.

### 1.2 Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (LTS) |
| Language | TypeScript |
| Framework | Express.js |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Auth | Clerk (JWT) |
| Payments | Stripe |
| Email | Resend |
| File Storage | Cloudflare R2 |
| Real-time | Server-Sent Events (SSE) |
| QR Generation | Server-side (`qrcode` package) |
| Hosting | Hostinger VPS |
| Package manager | pnpm |

### 1.3 Architecture pattern

Single Node.js monolith with:
- **REST API** — Express router, versioned under `/api/v1`
- **Background job runner** — in-process cron (node-cron) for SLA escalations, package expiry checks, no-show auto-flip
- **SSE endpoint** — `/api/v1/admin/stream` for real-time dashboard updates

No microservices, no message queue in v1.

---

## 2. Authentication & Authorization

### 2.1 Clerk integration

- Clerk issues JWTs. Every request to protected endpoints must carry `Authorization: Bearer <clerk_jwt>`.
- Backend verifies the JWT using the Clerk SDK (`@clerk/backend`). No custom JWT signing.
- Clerk user metadata (`publicMetadata.role`) carries one of: `client`, `studio_admin`, `instructor`, `super_admin`.
- Role is set on Clerk user creation by the backend (via Clerk Management API), not by the client.

### 2.2 Role middleware

```
verifyAuth         → validates Clerk JWT, attaches req.auth (userId, role)
requireRole(roles) → checks req.auth.role is in the allowed set, else 403
```

Applied at router level, not controller level.

### 2.3 Impersonation

- Super-admin sends `X-Impersonate-Admin-Id: <studioAdminClerkId>` header.
- Middleware validates: caller is `super_admin`, target is `studio_admin`, writes impersonation-start audit row.
- `req.auth.actingAs` is set to the target studio admin for the remainder of the request.
- Every state-changing handler checks `req.auth.actingAs` and records both `actor_id` and `impersonated_by` on the audit row.

### 2.4 Instructor row-level scope

Instructor endpoints filter all queries with `WHERE instructor_id = req.auth.userId`. No runtime config — enforced in the query layer (Drizzle). Any handler that touches instructor-scoped data must apply this filter before executing.

---

## 3. Database Schema

### 3.1 Conventions

- All primary keys: `uuid` (gen_random_uuid()).
- All timestamps: `timestamptz`, stored in UTC.
- Soft deletes: `archived_at timestamptz` (nullable). Hard deletes are not used.
- Drizzle schema files live in `src/db/schema/`.

### 3.2 Core tables

#### `locations`
```
id            uuid PK
name          text NOT NULL
address       text NOT NULL
hours         jsonb            -- { mon: "07:00-21:00", ... }
created_at    timestamptz
```

#### `users` (mirrors Clerk users; local projection)
```
id            uuid PK          -- matches Clerk userId
email         text UNIQUE NOT NULL
phone         text
name          text NOT NULL
role          enum('client','instructor','studio_admin','super_admin') NOT NULL
archived_at   timestamptz
created_at    timestamptz
updated_at    timestamptz
```

#### `clients` (extends users where role = 'client')
```
user_id            uuid PK FK → users.id
waiver_signed_at   timestamptz
waiver_version     int
waiver_reset_at    timestamptz
location_pref      uuid FK → locations.id  -- UX preference only
referral_code      text UNIQUE
referred_by        uuid FK → clients.user_id
created_at         timestamptz
```

#### `instructors` (extends users where role = 'instructor')
```
user_id        uuid PK FK → users.id
bio            text
photo_url      text           -- R2 URL
private_rate   numeric(10,2)  -- per session rate; admin-overridable
created_at     timestamptz
```

#### `class_templates`
```
id             uuid PK
title          text NOT NULL
description    text
duration_min   int NOT NULL
default_capacity int NOT NULL
default_instructor_id uuid FK → instructors.user_id
location_id    uuid FK → locations.id NOT NULL
archived_at    timestamptz
created_at     timestamptz
```

#### `class_instances`
```
id              uuid PK
template_id     uuid FK → class_templates.id
title           text NOT NULL      -- denormalized for display
instructor_id   uuid FK → instructors.user_id NOT NULL
location_id     uuid FK → locations.id NOT NULL
starts_at       timestamptz NOT NULL
ends_at         timestamptz NOT NULL
capacity        int NOT NULL
waitlist_enabled boolean DEFAULT false
status          enum('scheduled','completed','cancelled') DEFAULT 'scheduled'
cancelled_at    timestamptz
cancelled_by    uuid FK → users.id
created_at      timestamptz
updated_at      timestamptz
```

#### `workshops`
```
id              uuid PK
title           text NOT NULL
description     text
location_id     uuid FK → locations.id NOT NULL
starts_at       timestamptz NOT NULL
ends_at         timestamptz NOT NULL
capacity        int NOT NULL
price_early     numeric(10,2)
price_standard  numeric(10,2) NOT NULL
price_member    numeric(10,2)
archived_at     timestamptz
created_at      timestamptz
updated_at      timestamptz
```

#### `packages`
```
id              uuid PK
name            text NOT NULL
type            enum('bundle','unlimited','private_vip') NOT NULL
credit_count    int          -- null for unlimited
session_count   int          -- for private_vip only
validity_days   int NOT NULL
price           numeric(10,2) NOT NULL
archived_at     timestamptz
created_at      timestamptz
updated_at      timestamptz
```

#### `client_packages` (issued entitlement)
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
package_id      uuid FK → packages.id NOT NULL
status          enum('active','queued','expired','cancelled') DEFAULT 'active'
credit_balance  int          -- null for unlimited; decremented on booking
session_balance int          -- for private_vip
expires_at      timestamptz NOT NULL
issued_by       uuid FK → users.id   -- null = self-purchased
issue_reason    text                 -- mandatory for manual grants
invoice_id      uuid FK → invoices.id
queued_after    uuid FK → client_packages.id  -- for queued packages
created_at      timestamptz
updated_at      timestamptz
```

#### `invoices`
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
type            enum('package','workshop') NOT NULL
amount          numeric(10,2) NOT NULL
currency        char(3) DEFAULT 'SGD'
stripe_payment_intent_id text
status          enum('pending','paid','refund_requested','refunded') DEFAULT 'pending'
paid_at         timestamptz
created_at      timestamptz
updated_at      timestamptz
```

#### `bookings`
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
booking_type    enum('class','workshop','private') NOT NULL
class_instance_id  uuid FK → class_instances.id
workshop_id        uuid FK → workshops.id
private_request_id uuid FK → private_session_requests.id
status          enum('pending','confirmed','expired','cancelled','attended','late','no_show') NOT NULL
client_package_id  uuid FK → client_packages.id  -- credit/session source
qr_code_url     text                              -- R2 URL of generated QR image
qr_token        text UNIQUE                       -- YS-BOOKING-{id}-{token}
cancelled_at    timestamptz
cancel_reason   text
created_at      timestamptz
updated_at      timestamptz
```

#### `private_session_requests`
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
instructor_id   uuid FK → instructors.user_id NOT NULL
location_id     uuid FK → locations.id NOT NULL
requested_at    timestamptz NOT NULL     -- desired slot
message         text
status          enum('pending','confirmed','expired','declined') DEFAULT 'pending'
response_note   text
responded_by    uuid FK → users.id
sla_deadline    timestamptz NOT NULL     -- submitted_at + 12h
escalated_at    timestamptz
created_at      timestamptz
updated_at      timestamptz
```

#### `instructor_availability`
```
id              uuid PK
instructor_id   uuid FK → instructors.user_id NOT NULL
day_of_week     smallint     -- 0=Sun…6=Sat; null for one-off override
override_date   date         -- null for recurring blocks
start_time      time NOT NULL
end_time        time NOT NULL
location_id     uuid FK → locations.id
is_blocked      boolean DEFAULT false   -- true = unavailable override
created_at      timestamptz
```

#### `cancellation_policy`
```
id              uuid PK DEFAULT gen_random_uuid()  -- single row
class_window_hours     int NOT NULL DEFAULT 4
workshop_window_days   int NOT NULL DEFAULT 7
private_window_hours   int NOT NULL DEFAULT 24
updated_by      uuid FK → users.id
updated_at      timestamptz
```

#### `refund_requests`
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
invoice_id      uuid FK → invoices.id NOT NULL
reason          text NOT NULL
status          enum('open','resolved','declined') DEFAULT 'open'
admin_notes     text
resolved_by     uuid FK → users.id
resolved_at     timestamptz
created_at      timestamptz
```

#### `cancellation_requests` (membership pause/cancel)
```
id              uuid PK
client_id       uuid FK → clients.user_id NOT NULL
reason          text NOT NULL
status          enum('open','resolved') DEFAULT 'open'
admin_notes     text
resolved_by     uuid FK → users.id
resolved_at     timestamptz
created_at      timestamptz
```

#### `audit_logs`
```
id              uuid PK
actor_id        uuid FK → users.id NOT NULL
actor_role      text NOT NULL
impersonated_by uuid FK → users.id    -- super_admin id, nullable
action          text NOT NULL         -- e.g. 'credit.adjust', 'booking.cancel', 'waiver.reset'
target_type     text NOT NULL         -- e.g. 'client', 'booking', 'class_instance'
target_id       uuid NOT NULL
reason          text
metadata        jsonb                 -- before/after snapshot, amounts, etc.
created_at      timestamptz NOT NULL
```
Append-only. No UPDATE/DELETE permitted — enforced via DB trigger.

#### `notification_templates`
```
id              uuid PK
event_type      text UNIQUE NOT NULL   -- e.g. 'booking-confirmed'
factory_subject text NOT NULL
factory_body    text NOT NULL          -- Handlebars/Mustache template
override_subject text
override_body   text
version         int DEFAULT 1
updated_by      uuid FK → users.id
updated_at      timestamptz
```

#### `notification_sends`
```
id              uuid PK
recipient_id    uuid FK → users.id NOT NULL
event_type      text NOT NULL
template_version int NOT NULL
channel         text DEFAULT 'email'
status          enum('queued','sent','delivered','bounced','failed') DEFAULT 'queued'
resend_message_id text
triggered_by    uuid FK → users.id    -- null = system
booking_id      uuid FK → bookings.id
created_at      timestamptz
updated_at      timestamptz
```

#### `feature_flags`
```
id              uuid PK
key             text UNIQUE NOT NULL
enabled         boolean DEFAULT false
updated_by      uuid FK → users.id
updated_at      timestamptz
```

#### `class_ratings`
```
id              uuid PK
booking_id      uuid FK → bookings.id UNIQUE NOT NULL
client_id       uuid FK → clients.user_id NOT NULL
class_instance_id uuid FK → class_instances.id NOT NULL
rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5)
created_at      timestamptz
```

#### `marketing_content`
```
id              uuid PK DEFAULT gen_random_uuid()  -- single row
hero_heading    text
hero_subheading text
pricing_blurb   text
footer_text     text
updated_by      uuid FK → users.id
updated_at      timestamptz
```

---

## 4. API Routes

Base path: `/api/v1`

### 4.1 Auth / Webhooks

| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/clerk` | Clerk user lifecycle events (user.created, user.updated) — sync to local `users` table |
| POST | `/webhooks/stripe` | Stripe payment events (payment_intent.succeeded, etc.) |

### 4.2 Public (no auth)

| Method | Path | Description |
|---|---|---|
| GET | `/locations` | List both locations |
| GET | `/classes` | List upcoming class instances (public schedule) |
| GET | `/workshops` | List upcoming workshops |
| GET | `/packages` | List purchasable packages |
| GET | `/marketing` | Get marketing content (landing page copy) |

### 4.3 Client (`role: client`)

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Own profile + active package + balances + waiver state |
| PATCH | `/me` | Update name, phone, location preference |
| GET | `/me/bookings` | Booking history |
| POST | `/me/bookings/class` | Book a class instance (deducts credit) |
| POST | `/me/bookings/workshop` | Purchase workshop seat (initiates Stripe PaymentIntent) |
| DELETE | `/me/bookings/:id` | Cancel booking (policy enforced) |
| GET | `/me/bookings/:id/qr` | Get QR code image for a confirmed booking |
| POST | `/me/packages/purchase` | Purchase a package (initiates Stripe PaymentIntent) |
| GET | `/me/packages` | Own package history + current entitlement |
| GET | `/me/invoices` | Invoice history |
| POST | `/me/refund-requests` | Submit refund request |
| POST | `/me/cancellation-requests` | Submit membership cancellation/pause request |
| POST | `/me/waiver/sign` | Sign waiver (records version + timestamp) |
| GET | `/me/waiver` | Waiver state + current waiver text |
| POST | `/me/private-requests` | Submit private session request |
| GET | `/me/private-requests` | Own private session request history |
| GET | `/me/referral` | Own referral code + attribution list |
| POST | `/ratings/:bookingId` | Submit post-class rating |

### 4.4 Instructor (`role: instructor`)

| Method | Path | Description |
|---|---|---|
| GET | `/instructor/today` | Own classes today with roster |
| GET | `/instructor/schedule` | Own assigned class instances |
| GET | `/instructor/classes/:id/roster` | Roster for own class (name + check-in state only) |
| POST | `/instructor/classes/:id/checkin` | Scan QR / manual check-in for own class |
| GET | `/instructor/private-requests` | Own pending private session requests |
| PATCH | `/instructor/private-requests/:id` | Approve or decline (mandatory reason on decline) |
| GET | `/instructor/availability` | Own availability blocks |
| PUT | `/instructor/availability` | Replace availability blocks |
| GET | `/instructor/profile` | Own profile |
| PATCH | `/instructor/profile` | Update own bio, photo, rate |
| GET | `/instructor/teaching-log` | Own teaching log |
| GET | `/instructor/ratings` | Own class ratings aggregate |

### 4.5 Studio Admin (`role: studio_admin`)

#### Schedule
| Method | Path | Description |
|---|---|---|
| GET | `/admin/schedule` | Class instances (filter: location, date range) |
| POST | `/admin/schedule/instances` | Create single class instance |
| POST | `/admin/schedule/bulk-generate` | Generate instances from template over date range |
| PATCH | `/admin/schedule/instances/:id` | Edit instance (instructor, capacity, time) |
| DELETE | `/admin/schedule/instances/:id` | Cancel class instance (auto-return credits) |

#### Class Templates
| Method | Path | Description |
|---|---|---|
| GET | `/admin/class-templates` | List templates |
| POST | `/admin/class-templates` | Create template |
| PATCH | `/admin/class-templates/:id` | Update template |
| DELETE | `/admin/class-templates/:id` | Archive template |

#### Workshops
| Method | Path | Description |
|---|---|---|
| GET | `/admin/workshops` | List workshops |
| POST | `/admin/workshops` | Create workshop |
| PATCH | `/admin/workshops/:id` | Update workshop |
| DELETE | `/admin/workshops/:id` | Archive workshop |
| GET | `/admin/workshops/:id/roster` | Workshop roster |

#### Packages Catalog
| Method | Path | Description |
|---|---|---|
| GET | `/admin/packages` | List packages |
| POST | `/admin/packages` | Create package |
| PATCH | `/admin/packages/:id` | Update package |
| DELETE | `/admin/packages/:id` | Archive package |

#### Clients
| Method | Path | Description |
|---|---|---|
| GET | `/admin/clients` | List clients (search, filter) |
| GET | `/admin/clients/:id` | Client detail (profile, membership, balances, bookings, invoices, audit) |
| POST | `/admin/clients/:id/credits/adjust` | Manual credit adjustment (mandatory reason) |
| POST | `/admin/clients/:id/sessions/adjust` | Manual session adjustment (mandatory reason) |
| POST | `/admin/clients/:id/packages/issue` | Issue package (mutex resolution enforced) |
| POST | `/admin/clients/:id/waiver/reset` | Reset waiver for client (mandatory reason) |
| POST | `/admin/clients/:id/force-logout` | Force logout via Clerk API |
| POST | `/admin/clients/:id/reset-password` | Trigger password reset email via Clerk |

#### Instructors
| Method | Path | Description |
|---|---|---|
| GET | `/admin/instructors` | List instructors |
| GET | `/admin/instructors/:id` | Instructor detail + teaching log + ratings |
| POST | `/admin/instructors` | Create instructor account |
| PATCH | `/admin/instructors/:id` | Update instructor (rate override, etc.) |
| DELETE | `/admin/instructors/:id` | Archive instructor |

#### Inboxes
| Method | Path | Description |
|---|---|---|
| GET | `/admin/private-requests` | All private session requests (all instructors) |
| PATCH | `/admin/private-requests/:id` | Approve/decline on behalf of instructor |
| GET | `/admin/refund-requests` | Refund request inbox |
| PATCH | `/admin/refund-requests/:id` | Mark resolved/declined with notes |
| GET | `/admin/cancellation-requests` | Membership cancellation inbox |
| PATCH | `/admin/cancellation-requests/:id` | Mark resolved with notes |

#### Attendance
| Method | Path | Description |
|---|---|---|
| POST | `/admin/checkin` | Scan QR or manual check-in (any class) |

#### Reports
| Method | Path | Description |
|---|---|---|
| GET | `/admin/reports/attendance` | Attendance report |
| GET | `/admin/reports/revenue` | Revenue report |
| GET | `/admin/reports/membership` | Membership report |
| GET | `/admin/reports/teaching-log` | Teaching log (all instructors) |
| GET | `/admin/reports/ratings` | Class ratings report |
| GET | `/admin/reports/inbox-throughput` | Inbox throughput report |
| GET | `/admin/reports/referrals` | Referral attribution report |

All report endpoints accept `?from=&to=&location_id=&export=csv`.

#### Settings + Notifications
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/admin/settings/cancellation-policy` | Get/update cancellation windows |
| GET/PUT | `/admin/settings/waiver` | Get/update waiver text + version |
| GET/PUT | `/admin/settings/locations/:id` | Update location metadata |
| GET | `/admin/notifications/templates` | List all templates |
| PATCH | `/admin/notifications/templates/:event` | Update studio override for template |
| DELETE | `/admin/notifications/templates/:event/override` | Reset override to factory |
| POST | `/admin/notifications/resend` | Resend a notification (mandatory reason) |

#### Audit + Stream
| Method | Path | Description |
|---|---|---|
| GET | `/admin/audit-log` | Searchable global audit log |
| GET | `/admin/stream` | SSE stream — dashboard real-time events |

### 4.6 Super Admin (`role: super_admin`)

| Method | Path | Description |
|---|---|---|
| GET | `/super/health` | System health (DB ping, queue depths, error rates) |
| GET/PATCH | `/super/feature-flags` | List/toggle feature flags |
| GET | `/super/feature-flags/:key` | Single flag |
| GET/PATCH | `/super/notifications/factory/:event` | Factory template CRUD |
| POST | `/super/waiver/bulk-reset` | Bulk waiver reset (mandatory reason) |
| POST | `/super/impersonate` | Start impersonation session |
| DELETE | `/super/impersonate` | End impersonation session |
| GET | `/super/studio-admins` | List studio admin accounts |
| POST | `/super/studio-admins` | Create studio admin account |
| POST | `/super/studio-admins/:id/force-logout` | Force logout |
| GET | `/super/reports/:type` | Read-only report mirror |
| GET | `/super/audit-log` | Audit log (includes impersonation events) |

---

## 5. Business Logic Services

### 5.1 `BookingService`

- `bookClass(clientId, classInstanceId)` — validate waiver, check credit balance on active `client_package`, check class not full, deduct 1 credit, create booking (`confirmed`), generate QR, send `booking-confirmed` email.
- `cancelBooking(bookingId, actorId)` — load policy, check window, forfeit or return credit, update booking state, send cancellation email.
- `checkin(qrToken, actorId)` — parse `YS-BOOKING-{id}-{token}`, validate class is active window, flip state to `attended` or `late`, emit SSE event.
- `adminCancelClass(classInstanceId, actorId)` — flip instance to `cancelled`, return 1 credit to every `confirmed` booking's source package, send `class-cancelled` email to all booked clients, write audit row.

### 5.2 `PackageService`

- `issuePackage(clientId, packageId, actorId, reason?)` — check mutex (§3.6 of product PRD), either queue or replace current, create `client_packages` row + `invoices` row (manual issuance), write audit row.
- `purchasePackage(clientId, packageId)` — create Stripe PaymentIntent, create `invoices` row as `pending`; activated on `payment_intent.succeeded` webhook.
- `adjustCredits(clientId, delta, actorId, reason)` — update `credit_balance` on active package, write audit row (mandatory reason enforced).

### 5.3 `PrivateSessionService`

- `submitRequest(clientId, instructorId, slot, locationId, message)` — create request with `sla_deadline = now + 12h`, send `private-request-received` email.
- `respond(requestId, actorId, approved, note?)` — if approved: deduct 1 session from `client_packages`, create `confirmed` booking, send `private-request-approved` email. If declined: mandatory reason, send `private-request-declined`.
- `expireStaleSessions()` — cron job every 5 min; flip overdue pending requests to `expired`, send `private-request-expired`, emit SSE event.
- `escalateSLA()` — cron job every 5 min; at `sla_deadline - 6h`, send `private-sla-escalation` to studio admin, set `escalated_at`.

### 5.4 `NotificationService`

- `send(eventType, recipientId, variables, triggeredBy?)` — resolve template (override > factory), render via Mustache, send via Resend, write `notification_sends` row.
- `resend(notificationSendId, actorId, reason)` — fetch original send row, re-send, write audit row.

### 5.5 `QRService`

- `generate(bookingId)` — compute token `YS-BOOKING-{bookingId}-{uuid}`, generate QR image using `qrcode`, upload PNG to R2 under `qr/{bookingId}.png`, return public URL + token.

### 5.6 `AttendanceService`

- Cron job every 1 min post-class-end: flip all `confirmed` bookings past `starts_at + 30min` to `no_show`.
- Cron job every 5 min: flip `class_instances` past `ends_at` to `completed`, create `teaching_log` row (implicit from instance state, or materialized view).

### 5.7 `PackageExpiryService`

- Cron job daily: flip `client_packages` past `expires_at` to `expired`.
- Cron job daily: send `package-lapsing-soon` for packages expiring within 7 days (deduplicated — one send per package).
- Cron job daily: send `package-expired` for newly expired packages.

### 5.8 `WaiverService`

- `bulkReset(actorId, reason)` — set `waiver_reset_at = now` on all `clients`, write single platform audit row + per-client trigger row.
- `checkRequired(clientId)` — returns `{required: bool}` — true if `waiver_signed_at` is null, `waiver_reset_at > waiver_signed_at`, or `waiver_signed_at < now - 12 months`.

---

## 6. Real-time (SSE)

Endpoint: `GET /api/v1/admin/stream` (studio admin + super admin only)

Events emitted to connected admin clients:

| Event | Payload | Trigger |
|---|---|---|
| `private.request.new` | `{requestId, clientName, instructorName, slot}` | New private session submitted |
| `private.sla.escalation` | `{requestId, slaDeadline}` | SLA escalation fires |
| `checkin` | `{bookingId, clientName, classId, state}` | QR check-in processed |
| `class.cancelled` | `{classInstanceId, title, affectedCount}` | Admin cancels class |
| `refund.request.new` | `{requestId, clientName}` | New refund request submitted |
| `cancellation.request.new` | `{requestId, clientName}` | New cancellation request submitted |

SSE connection is per-user. No fan-out to other roles. Connection uses `Last-Event-ID` for reconnection.

---

## 7. File Storage (Cloudflare R2)

Bucket structure:

```
r2://yoga-sadhana/
  qr/{bookingId}.png          -- per-booking QR images
  profiles/{userId}.jpg       -- instructor/admin profile photos
```

- Uploads via signed PUT URL (backend generates, client uploads directly to R2).
- Public read via R2 public bucket domain (no proxy needed for images).
- QR images are generated server-side and uploaded by the backend, never by the client.

---

## 8. Stripe Integration

### 8.1 Flow

1. Client calls `POST /me/packages/purchase` or `POST /me/bookings/workshop`.
2. Backend creates Stripe `PaymentIntent` (amount in SGD cents, `metadata: {type, referenceId, clientId}`).
3. Returns `{clientSecret}` to frontend.
4. Frontend completes payment using Stripe.js.
5. Stripe sends `payment_intent.succeeded` webhook to `/api/v1/webhooks/stripe`.
6. Backend activates the package or confirms the workshop booking.

### 8.2 Webhook security

Stripe webhook signature verified via `stripe.webhooks.constructEvent` using `STRIPE_WEBHOOK_SECRET`. Reject all unsigned requests with 400.

### 8.3 Refunds (out-of-app)

No Stripe refund API calls in v1. Refunds are handled out-of-app via PayNow/WhatsApp. The `refund_requests` table tracks the admin inbox only.

---

## 9. Background Jobs (node-cron)

| Job | Schedule | Action |
|---|---|---|
| `expire-private-requests` | Every 5 min | Expire overdue private session requests |
| `escalate-private-sla` | Every 5 min | Escalate requests nearing SLA |
| `flip-no-shows` | Every 1 min | Flip unattended bookings after 30min post-start |
| `complete-classes` | Every 5 min | Flip past-end class instances to `completed` |
| `expire-packages` | Daily 01:00 SGT | Expire past-`expires_at` packages |
| `lapsing-package-alert` | Daily 08:00 SGT | Send lapsing-soon emails (7-day window) |
| `expired-package-notify` | Daily 08:00 SGT | Send package-expired emails |
| `waiver-expiry-check` | Daily 02:00 SGT | Flag waivers past 12-month anniversary |

All jobs log to a simple `job_runs` table (`job_name`, `started_at`, `finished_at`, `error`).

---

## 10. Security

- All endpoints require HTTPS (enforced at reverse proxy / Hostinger level).
- Clerk JWT expiry: 1 hour (default). Refresh handled by frontend SDK.
- MFA enforced for `super_admin` role (configured in Clerk dashboard).
- Rate limiting: 100 req/min per IP on public routes, 300 req/min per authenticated user.
- Input validation: `zod` schemas on all request bodies and query params.
- No raw SQL queries — all queries through Drizzle ORM.
- CORS: allow-list to fe-client and fe-admin origins only.
- Stripe and Clerk webhook endpoints: signature-verified, excluded from auth middleware.

---

## 11. Project Structure

```
src/
  db/
    schema/          -- Drizzle table definitions
    migrations/      -- Drizzle migration files
    index.ts         -- DB connection (postgres.js)
  routes/
    public.ts
    client.ts
    instructor.ts
    admin.ts
    super.ts
    webhooks.ts
  services/
    booking.service.ts
    package.service.ts
    private-session.service.ts
    notification.service.ts
    qr.service.ts
    attendance.service.ts
    waiver.service.ts
  middleware/
    auth.ts
    impersonate.ts
    require-role.ts
    validate.ts
  jobs/
    index.ts         -- registers all cron jobs
  lib/
    clerk.ts
    stripe.ts
    resend.ts
    r2.ts
    sse.ts
  app.ts
  server.ts
```

---

## 12. Environment Variables

```
DATABASE_URL
CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_URL
PORT
NODE_ENV
```

---

## 13. v1 Out of Scope (backend)

- WebSocket (SSE is sufficient for v1 unidirectional push)
- GraphQL / tRPC
- Message queue (BullMQ, RabbitMQ) — in-process cron is sufficient for v1 load
- WhatsApp / SMS / push notification channels
- In-app Stripe refund API calls
- Multi-tenant routing
- Instructor pay computation
- Auto-renewing memberships
- Native mobile API variations
