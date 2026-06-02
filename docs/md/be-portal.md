# Backend — Portal (`fe-portal`)

The staff-side backend surface. Implements the admin and instructor scopes of the staff app. Reads from `admin-restructure.md` for **behavior**; this doc maps that behavior onto routes, services, and database tables defined in `backend-architecture.md`.

- Spine: `backend-architecture.md` (stack, folder structure, full DB schema, integrations, jobs, shared cross-cutting).
- Behavior source of truth: `admin-restructure.md`.
- Sister doc: `be-client.md` (client surface).

---

## 1. Mount & Auth

```
/api/v1/portal/admin/*       — require Clerk staff JWT + role in {admin, superadmin}
/api/v1/portal/instructor/*  — require Clerk staff JWT + role in {instructor, admin, superadmin}
```

Both subtrees mount under `routes/portal/index.ts`, which applies a single `clerk-staff.ts` middleware (verifies the staff Clerk app's JWT issuer; rejects client-app tokens). Role-specific gates live on the subtrees:

```ts
const portalRoutes = new Hono()
  .use('*', clerkStaffAuth, requireActiveStaff)
  .use('*', auditMiddleware)
  .route('/admin',      adminRoutes)        // .use('*', requireRole('admin', 'superadmin'))
  .route('/instructor', instructorRoutes);  // .use('*', requireRole('instructor', 'admin', 'superadmin'))
```

`requireActiveStaff` rejects any `staff_users.status` not equal to `'active'` (i.e. `pending` or `archived`). Cross-app tokens (a client JWT presented to `/portal/*`) are rejected by the Clerk staff verifier.

`auditMiddleware` writes one `audit_log` row per successful mutating request (`POST | PUT | PATCH | DELETE`). Idempotent reads do not audit.

### Workspace scoping & role gates

Per `admin-restructure.md` Overview + §15a, admin surfaces partition into three buckets:

| Bucket | Surfaces | Gate |
|---|---|---|
| **Global (superadmin-only)** | Locations, Rooms, Class Types, Class Packages, Workshops, PT Packages, Promotions, Global Policy, Notifications, Waiver, Staff | `requireRole('superadmin')` on the entire router |
| **Workspace-scoped** | Schedule, Check-in, Inbox | `requireRole('admin', 'superadmin')` **+ `requireWorkspaceScope`** middleware (below). Reads filter by `granted_location_ids`; writes reject if the target `location_id` is not in the set. |
| **Workspace-agnostic** | PT Requests, Clients (read-only for admin) | `requireRole('admin', 'superadmin')`. No location filter. |

```ts
// middleware/require-workspace-scope.ts
// For workspace-scoped writes: assert the target location_id is in ctx.staff.granted_location_ids.
// For reads: inject a WHERE filter on the resolved location_id, treating empty granted_location_ids
//           as "all active locations" (superadmin / implicit grant).
```

Superadmin always passes the workspace gate regardless of `granted_location_ids` (empty array = all locations is the explicit semantics; superadmin's row is seeded with `'{}'`).

---

## 2. Admin endpoints — `routes/portal/admin/*`

All endpoints are prefixed with `/api/v1/portal/admin`. Verbs and bodies are summarized; Zod schemas live next to each route file.

### `locations.ts`
| Method | Path | Body / params | Effect |
|---|---|---|---|
| GET | `/locations` | `?include_archived=true` | List `locations` |
| GET | `/locations/:id` | — | Detail |
| POST | `/locations` | `{ name, address, gmaps_url?, phone? }` | Insert |
| PATCH | `/locations/:id` | partial | Update |
| POST | `/locations/:id/archive` | — | Set `archived_at = now()`. **Blocks** if any `classes` / `workshops` / `pt_sessions` reference this location AND have `lifecycle='active'` AND `ends_at > now()`. Returns `409 location_in_use` with the offending session list. |
| POST | `/locations/:id/unarchive` | — | Clear `archived_at` |

### `rooms.ts`
Physical spaces, location-scoped. Building block under "Building Blocks" in fe-portal.
| Method | Path | Body / params | Effect |
|---|---|---|---|
| GET | `/rooms` | `?location_id=&include_archived=true` | List `rooms` (optionally filtered to one location) |
| GET | `/rooms/:id` | — | Detail |
| POST | `/rooms` | `{ location_id, name, capacity }` | Insert. `capacity` must be ≥ 1. |
| PATCH | `/rooms/:id` | `{ name?, capacity? }` | Update (location is immutable) |
| POST | `/rooms/:id/archive` | — | Set `archived_at`. **Blocks** with `409 room_in_use` if any active future `classes` / `workshop_days` / `pt_sessions` reference it. |
| POST | `/rooms/:id/unarchive` | — | Clear `archived_at` |

**Scheduling integration.** `room_id` is now a **required** field on the create/reschedule paths for classes (`schedule.ts → POST /schedule/classes`), workshop days (`workshops.ts → POST/PATCH /workshops/:id/days`), and PT sessions (`pt-sessions approve`). The service layer validates the room belongs to the session's location (`400 room_location_mismatch` / `400 room_archived` / `404 room_not_found`) and that it is clash-free — two active sessions can't share a room at overlapping times, checked across all three tables. A clash returns `409 room_clash` with `{ conflicts: [{ kind, id, starts_at, ends_at }] }`.

### `class-types.ts`
Same CRUD shape as locations. Archive is blocked if any non-archived `instructor_class_types` references the type, or any active future `classes` / `workshops` reference it.

### `instructors.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/instructors` | List with `?status=pending|active|archived`, joins `staff_users` |
| GET | `/instructors/:id` | Detail incl. `instructor_class_types` eligibility, photo presigned URL |
| POST | `/instructors` | Create `staff_users` row (role=`instructor`, status=`pending`) + `instructors` row + `instructor_class_types` rows + auto-fires staff invitation (see §3a) |
| PATCH | `/instructors/:id` | Update bio, phone override, eligible class types. Photo upload via presigned R2 PUT URL flow (see `backend-architecture.md` §6c). |
| POST | `/instructors/:id/archive` | Set `staff_users.archived_at`, call Clerk `revokeAllSessions(clerk_user_id)`. Blocks on active future sessions where this instructor is assigned. |
| POST | `/instructors/:id/resend-invite` | Re-issue invitation (§3a) — only if `status='pending'` |

### `policy.ts`
| Method | Path | Body | Effect |
|---|---|---|---|
| GET | `/policy` | — | `{ global_policy, pt_booking_config }` |
| PATCH | `/policy/global` | `{ cancel_cap_count, cancel_cap_cycle_days, class_window_hours, pt_window_hours }` | Update singleton row |
| PATCH | `/policy/pt` | `{ book_in_advance_days }` | Update singleton row |

### `class-packages.ts` (superadmin-only)
| Method | Path | Notes |
|---|---|---|
| GET | `/class-packages` | List with `?status`, `?kind=credit_bundle\|unlimited\|trial`. Default sort: trial first, then credit_bundle, then unlimited (matches fe-client `/packages` ordering). |
| POST | `/class-packages` | Insert `class_packages` row. CHECK constraint enforces kind-specific column requirements (credits + validity_days for `credit_bundle`; duration_days for `unlimited`; credits + nullable validity_days for `trial`). |
| PATCH | `/class-packages/:id` | Edit name, description, status. Price changes apply to **future** purchases only — existing `client_packages` rows are immutable. |
| POST | `/class-packages/:id/archive` | Soft delete; existing client_packages remain valid until `expires_at`. |

**Trial Pass semantics.** `kind='trial'` is just another row — there is no separate route. The one-per-client gate lives at purchase time (`be-client.md` §4e), enforced by the `client_packages(client_id) WHERE kind='trial'` unique partial index. Admin **may** publish multiple active Trial Pass definitions (e.g. for A/B testing), but a single client can hold at most one across all of them.

### `pt-packages.ts` (superadmin-only)
Same shape as class-packages, with PT-specific fields. Adds `description` column edits.

### `promotions.ts` (superadmin-only — `admin-restructure.md` §5d, §19, `fe-client-features.md` §6.1)

Promotions are nested under their parent (class package, PT package, or workshop). There is no top-level Promotions page in the admin nav — the editor lives inside the package/workshop dialog. The API mirrors that shape.

| Method | Path | Notes |
|---|---|---|
| GET | `/class-packages/:id/promotions` | List promotions on this class package (any status) |
| POST | `/class-packages/:id/promotions` | `{ label, kind: 'percent'\|'special_price', percent_off?, special_price_sgd?, starts_at, ends_at }`. CHECK enforces kind-specific column presence. |
| PATCH | `/class-packages/:id/promotions/:promotion_id` | Edit any field. **No retroactive effect** — already-purchased `client_packages.applied_promotion_id` rows are frozen. |
| POST | `/class-packages/:id/promotions/:promotion_id/archive` | Manual disable independent of time window |
| GET / POST / PATCH / DELETE | `/pt-packages/:id/promotions[/:promotion_id]` | Same shape on PT packages |
| GET / POST / PATCH / DELETE | `/workshops/:id/promotions[/:promotion_id]` | Same shape on workshops |

**Best-price-wins is server-side at purchase.** Admin does not pick "the active" promotion — every windowed `status='active'` row is a candidate. See `services/promotions/resolve.ts:bestPriceFor(parent_type, parent_id)`.

**Validation warnings (non-blocking).** When a promotion's effective price is higher than the parent's regular price, the API returns `200` with a `warnings: ['promotion_higher_than_regular']` field so the fe surfaces it but allows the write — best-price-wins simply ignores the row at purchase.

### `schedule.ts` (workspace-scoped)
| Method | Path | Effect |
|---|---|---|
| GET | `/schedule` | Unified timetable: union of `classes`, `workshop_days` (one tile per day with `Day N/M` chip per `admin-restructure.md` §7c), confirmed `pt_sessions`. **Filtered by `granted_location_ids`** at the middleware. Query filters: `?instructor_id`, `?class_type_id`, `?from`, `?to`, `?type=class\|workshop\|pt`. Each row carries `event_state` computed at read time per `services/policy/event-state.ts`. |
| POST | `/schedule/classes` | Create class instance. Body includes `capacity_online`, `capacity_waitlist`, `capacity_buffer` (the structured capacity per `admin-restructure.md` §7d). `location_id` must be in `granted_location_ids`. |
| PATCH | `/schedule/classes/:id` | Edit (rejects if any confirmed bookings AND material change, e.g. moving start time more than 15 min) |
| POST | `/schedule/classes/:id/cancel` | Admin cancellation — see §3b |
| POST | `/schedule/workshops/:id/cancel` | Admin cancellation of an entire workshop (all days, all tiers) + Stripe refund fanout to attendees — see §3b. **No** workshop create/edit here; those live in `workshops.ts`. |
| GET | `/schedule/workshops/picker` | Lists workshops in the active workspace that have at least one future `workshop_day`. Powers the "+ Workshop" picker in the scheduler per `admin-restructure.md` §7c — selecting from this list **does not create anything**; it just navigates to the workshop's days. |

### `workshops.ts` (workspace-scoped — `admin-restructure.md` §19, `fe-client-features.md` §4.1)

Workshops are configured under Packages (not Schedule). Three-stage editor: **Basics → Days → Tiers**. Workshop's `location_id` is fixed at creation; admin sees only their workspace's workshops.

| Method | Path | Effect |
|---|---|---|
| GET | `/workshops` | List workshops in the active workspace (filtered by `granted_location_ids`). `?status=active\|cancelled`, `?has_future_days=true`. |
| GET | `/workshops/:id` | Detail with `days[]`, `tiers[]`, `tier_days{}`, `images[]`, `instructors[]`, `promotions[]`. |
| POST | `/workshops` | **Basics stage** — `{ name, description_html, class_type_id, location_id, instructor_ids[], cover_r2_key?, images[]? }`. Returns the workshop id; days + tiers added in follow-up calls. `location_id` must be in `granted_location_ids`. |
| PATCH | `/workshops/:id` | Edit basics. `location_id` is **immutable** once `workshop_days` exist (changing workspace mid-flight is unsafe). |
| POST | `/workshops/:id/cancel` | Same as `schedule.ts:POST /schedule/workshops/:id/cancel` — exposed here too so the cancel action is reachable from the workshops surface. |
| **Days** | | |
| POST | `/workshops/:id/days` | `{ ord, starts_at, ends_at, base_price_sgd, capacity_online, capacity_waitlist, capacity_buffer }`. CHECK enforces `sum > 0`. |
| PATCH | `/workshops/:id/days/:day_id` | Edit. Capacity reductions reject if `count(confirmed bookings via tier→day join) > new capacity_online`. |
| DELETE | `/workshops/:id/days/:day_id` | Reject if any confirmed booking covers this day (via any tier in `workshop_tier_days`). |
| **Tiers** | | |
| POST | `/workshops/:id/tiers` | `{ name, description?, regular_price_sgd, early_bird_price_sgd?, early_bird_quota?, early_bird_cutoff_at?, day_ids[], ord }`. Inserts `workshop_tiers` + `workshop_tier_days` junction rows in one tx. **No `capacity` field** — derived. |
| PATCH | `/workshops/:id/tiers/:tier_id` | Edit. Changing `day_ids` requires rewriting the `workshop_tier_days` rows; rejected if confirmed bookings exist on the tier AND a covered day is being removed. |
| DELETE | `/workshops/:id/tiers/:tier_id` | Reject if any confirmed booking references this tier. |
| **Roster (per day for check-in / attendance)** | | |
| GET | `/workshops/:id/roster` | All confirmed bookings on the workshop (across tiers). Returns each booking with the `day_ids[]` it grants access to (joined via `workshop_tier_days`). |
| GET | `/workshops/:id/days/:day_id/roster` | Bookings whose tier covers this specific day. Used by the workshop check-in screen even though workshops are not check-in tracked in v1 — admin still needs the per-day attendee list. |

### `pt-requests.ts` (workspace-**agnostic** — `admin-restructure.md` §9)

PT requests are the actionable entity. **No back-and-forth in app — all negotiation is on WhatsApp.** The portal exposes exactly two terminal actions: **schedule** (the implicit approval) and **cancel**. There is no decline-with-note path and no approve button.

The admin queue is shared across workspaces (no `granted_location_ids` filter) because PT requests have no `location_id` until scheduled.

| Method | Path | Effect |
|---|---|---|
| GET | `/pt-requests` | Triage queue. Default `?status=pending`, ordered `created_at desc`. Filters: `?status`, `?class_type_id`, `?client_id`, `?session_type`, `?from`, `?to`. |
| GET | `/pt-requests/:id` | Detail incl. client profile snapshot, class type, all proposed slots (`pt_request_slots`), co-client (resolved `co_client_id` OR free-text `co_client_name + co_client_email`), message, expiry. |
| POST | `/pt-requests/:id/schedule` | Convert request → `pt_sessions` row. Body: `{ instructor_id, location_id, room_id, starts_at, ends_at, capacity_online?, capacity_waitlist?, capacity_buffer? }`. Calls `services/pt-sessions/schedule.ts:schedulePtRequest()` — see §3c. `location_id` must be in the acting admin's `granted_location_ids`. **For 2on1 requests with no `co_client_id` yet** the call rejects with 409 — admin must create the partner's client first via `/admin/clients`, the FE then re-opens the schedule dialog with `co_client_id` resolved. |
| POST | `/pt-requests/:id/cancel` | Admin cancel. Branches on current status: `pending` → `cancelled_before_scheduled` + refund (1 session for 1on1, 2 for 2on1) to the originating client package; `scheduled` → `cancelled_after_scheduled`, cascade-cancel the linked `pt_sessions` row + every booking on it (state='cancelled', refund_outcome='forfeited'), **no refund** (v1 policy). Emits `admin_cancel_class_pt` inbox row and emails the affected client(s). Idempotent — calling on an already-terminal request is a no-op. |

### `pt-sessions.ts` — removed

Admin-side PT actions all flow through `/pt-requests/*`. Cancellation of a scheduled session goes via `POST /pt-requests/:id/cancel` (branches as documented above) so the request and session stay in lockstep. Listing scheduled `pt_sessions` for the schedule view is handled by `schedule.ts:listScheduleItems`.

### `corporate-requests.ts` (gated `staffAny` — admin + superadmin, like pt-requests)

Corporate moved from **admin-direct-create** (admin made a `corporate_sessions` row with a freeform client name on the schedule) to a **request-driven flow mirroring PT**. A member buys a corporate package; the Stripe webhook auto-creates ONE pending `corporate_requests` row (no client form — negotiation is on WhatsApp). The portal exposes **schedule** (the implicit approval — no approve/decline step), **cancel**, and **mark attended**.

The old "+ corporate" package dropdown and the `/admin/schedule/new/corporate` direct-create page are **removed**. Corporate sessions are now created **only** by scheduling a pending request (see §3f).

| Method | Path | Effect |
|---|---|---|
| GET | `/corporate-requests` | Triage queue. `?status=pending\|scheduled\|cancelled\|attended\|all` (default `pending`). |
| GET | `/corporate-requests/:id` | Detail. |
| POST | `/corporate-requests/:id/schedule` | Schedule the pending request → creates the `corporate_sessions` row (reuses the existing corporate-session create logic: room/instructor conflict checks), sets `corporate_request_id`, flips request to `scheduled`. Body: `{ main_instructor_id, supporting_instructor_ids?, location_id, room_id, starts_at, ends_at }` → 201. See §3f. |
| POST | `/corporate-requests/:id/cancel` | Cancel. `pending` → `cancelled`; `scheduled` → `cancelled` + cancels the linked `corporate_sessions` row. |
| POST | `/corporate-requests/:id/attended` | `scheduled` → `attended`. |

**Schedule errors:** `404 request_not_found` / `404 package_not_found`; `409 not_pending` / `409 room_conflict` / `409 instructor_conflict`; `422 package_archived`; `400 main_in_supporting` / `400 bad_time_range`.

**Request JSON shape** (GET responses):

```jsonc
{
  "id": "...",
  "status": "pending",
  "message": null,
  "created_at": "...",
  "resolved_at": null,
  "client":  { "id": "...", "name": "...", "email": "..." },
  "package": { "id": "...", "name": "..." },
  "session": null
  // when scheduled:
  // "session": { "id", "starts_at", "ends_at", "location_name", "instructor_name" }
}
```

### `bookings.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/bookings` | List with filters (`?session_kind`, `?session_id`, `?client_id`) |
| GET | `/bookings/:id` | Detail |
| POST | `/bookings/:id/cancel` | Admin force-cancel (always full refund, bypasses cap — see §3b client-vs-admin path table) |
| POST | `/bookings/:id/no-show` | Mark `state='no_show'`, `check_in_state='no_show'`, fire forfeit logic |

### `check-in.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/check-in` | Generic page — current session candidates (sessions ongoing + class window) |
| POST | `/check-in/scan` | `{ qr_token | code, session_id }` — verify token/code matches a booking on this session, insert `check_ins` row, update `bookings.check_in_state='attended'` |
| POST | `/check-in/manual` | `{ booking_id }` — admin manual tick |

### `inbox.ts` (workspace-scoped)

Per `admin-restructure.md` §13, the Inbox is now a **read-only notification feed**. PT request triage moved to its dedicated page (`pt-requests.ts` above). Inbox items are filtered by `granted_location_ids` — admins see notifications for cancellations on their workspace's sessions only.

| Method | Path | Effect |
|---|---|---|
| GET | `/inbox` | List with `?type`, `?read`. Default sort created_at desc. Workspace-filtered. |
| GET | `/inbox/unread-count` | For badge. Workspace-filtered. |
| POST | `/inbox/:id/mark-read` | Set `read_at`, `read_by_staff_id` |

### `clients.ts`

Per `admin-restructure.md` §15a, **admin role is read-only on Clients**. Mutating endpoints below require `requireRole('superadmin')`; reads are open to both.

| Method | Path | Role | Effect |
|---|---|---|---|
| GET | `/clients` | admin+superadmin | List with search, status filter |
| GET | `/clients/:id` | admin+superadmin | Profile incl. packages (including any trial pass + active promotion frozen at purchase), booking history, cancellation count, attendance, referrals, waiver. Admin views are workspace-agnostic — Clients is global. |
| POST | `/clients/:id/suspend` | superadmin | Set `status='suspended'`, `suspended_at`. Calls Clerk `revokeAllSessions`. |
| POST | `/clients/:id/unsuspend` | superadmin | Reverse |
| POST | `/clients/:id/credits/adjust` | superadmin | `{ client_package_id, delta, reason }` — manual credit adjust. Valid for `kind in ('credit_bundle', 'unlimited', 'trial')`. See §3d. |
| POST | `/clients/:id/sessions/adjust` | superadmin | Same shape, for PT session balance (`kind='pt'`) |
| POST | `/clients/:id/packages/:client_package_id/expiry` | superadmin | `{ expires_at, reason }` — edit expiry on `client_packages` (per `admin-restructure.md` §16 "Edit expiry" action, applies to `credit_bundle`, `unlimited`, `trial`). Writes a `manual_adjustments` row with `delta=0` and the reason note. |
| POST | `/clients/:id/packages/issue` | superadmin | Admin grants a complimentary package (any kind). Inserts `client_packages` row with `amount_paid_sgd=0`, `stripe_payment_intent_id=NULL`. **Trial issue is gated by the `(client_id) WHERE kind='trial'` unique partial index** — returns `409 trial_already_used` if the client already holds a trial. |

### `staff.ts` (superadmin-only)
| Method | Path | Effect |
|---|---|---|
| GET | `/staff` | List staff_users + open invitations. Each row exposes `granted_location_ids` (resolved to `locations` rows in the response). |
| POST | `/staff/invite` | `{ email, role: 'admin', granted_location_ids: uuid[] }`. **Role restricted to `admin` in v1** — instructor invitations land via `POST /instructors` (which auto-fires an internally-typed invitation). Inviter's `granted_location_ids` must cover the requested set (superadmin always passes). See §3a. |
| POST | `/staff/invitations/:id/revoke` | Set `status='revoked'`. Re-invite requires fresh row. |
| PATCH | `/staff/:id/grants` | `{ granted_location_ids: uuid[] }` — superadmin shrinks/expands an admin's workspace grants without archiving (`admin-restructure.md` §15b "softer alternative"). Effective on next page load (no session revoke). |
| POST | `/staff/:id/archive` | Soft delete + Clerk session revoke. Superadmin cannot be archived. |

### `notifications.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/notifications/templates` | List 22 seeded templates |
| GET | `/notifications/templates/:slug` | Body + variable allow-list |
| PATCH | `/notifications/templates/:slug` | `{ subject, body_html }`. Render-time check: every `{{var}}` must appear in the slug's allow-list (`services/notifications/variables.ts`). Rejects with `400 unknown_variable` listing offenders — this is the source of the §17c amber flag in fe-portal. |
| GET | `/notifications/log` | Read-only `email_log` view, paginated, filter by slug + status |

### `waiver.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/waiver` | Singleton row + count of `waiver_signatures` |
| PATCH | `/waiver` | `{ body_html }`. **No versioning** — replaces in place. New clients sign current text on registration; existing signatures remain. |

### `marketing.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/marketing` | Singleton row |
| PATCH | `/marketing` | `{ hero_heading, hero_subheading, pricing_blurb?, testimonials?, footer_text? }`. Drives `/api/v1/public/marketing` reads. |

### `feature-flags.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/feature-flags` | List rows |
| PATCH | `/feature-flags/:key` | `{ enabled: bool }`. Updates DB + invalidates `lib/feature-flags-cache.ts` (process-local). Multi-instance deployments require pub/sub trigger — deferred. |

---

## 3. Portal-driven business flows

### 3a. Staff invitation flow

Triggered from: `POST /staff/invite` (admin/superadmin) or auto-fired during `POST /instructors`.

```
services/auth/invitations.ts:invite({ email, role, invited_by_staff_id })
  ↓
1. Insert staff_users row: { email, role, status='pending', clerk_user_id=NULL }
2. Insert staff_invitations row: { email, role, token, expires_at = now + 7d, status='pending', invited_by_staff_id, staff_user_id=staff_users.id }
3. Call Clerk's invitation API with redirect URL = fe-portal accept page + ?token=…
4. enqueueEmail('admin_invite' | 'instructor_invite', { email }, { invite_url, expires_at })
```

When the invitee clicks the link and signs in via Clerk:
- Clerk fires `user.created` webhook → `services/auth/webhook-sync.ts` matches by email, sets `staff_users.clerk_user_id` and `status='active'`, sets `staff_invitations.status='accepted'` and `accepted_at=now()`.
- If the email matches no pending invitation: webhook short-circuits (we don't auto-create staff from rogue sign-ins).

### 3b. Cancellation paths — admin vs. client

Both paths pass through `services/bookings/cancel.ts`. The branch is on the `source` parameter.

| Step | Client path (`source='client'`) | Admin path (`source='admin'`) |
|---|---|---|
| 1. Policy evaluation | Calls `services/policy/evaluate-cancellation.ts` — produces `{ refund: 'full' \| 'forfeit', reason }` based on cap + window | **Bypassed** — admin cancels are always full refund |
| 2. Refund decision | `refund='full'` → return credit (class) or session (PT) to `client_packages.credits_or_sessions_remaining`. `refund='forfeit'` → no return; booking still marked cancelled. | Always return credit/session. Workshops: enqueue `stripe-refund` (see below). |
| 3. Booking update | `state='cancelled'`, `refund_outcome` set per outcome | Same |
| 4. Cancellation row | Insert `cancellations` row with `source='client'`, `was_within_window`, `was_within_cap`, `refund_fired` | Insert `cancellations` row with `source='admin'` (excluded from cap calc) for class/PT only — workshops not represented |
| 5. Inbox | Insert `inbox_items` of `type='client_cancellation'` | Insert `inbox_items` of `type='admin_cancel_class_pt'` or `'admin_cancel_workshop'` |
| 6. Email | `class_cancelled_credit_returned` / `class_cancelled_forfeited` / `pt_cancelled_session_returned` / `pt_cancelled_forfeited` to client | `admin_cancel_class` / `admin_cancel_pt` / `admin_cancel_workshop` to all affected clients |

#### Workshop admin-cancel — refund fanout

`POST /schedule/workshops/:id/cancel`:

```
services/workshops/refund-fanout.ts:cancelWorkshop(workshop_id, actor_staff_id)
  ↓
tx start
1. Update workshops.lifecycle='cancelled', cancelled_at, cancelled_by_staff_id
2. SELECT bookings WHERE workshop_id=X AND state='confirmed' FOR UPDATE
3. For each booking:
   - Set state='cancelled', refund_outcome='stripe_refunded', cancelled_at
   - Enqueue stripe-refund job with idempotency key = booking.id
     (v1: enqueue is a synchronous Stripe Refund API call; failures retry inline 3x with exponential backoff;
      worst case the booking is left cancelled with refund_outcome unchanged, surfaced in admin alerts)
     (future: BullMQ — durable retry across restarts)
4. Insert one inbox_items row of type='admin_cancel_workshop' with payload:
   { workshop_id, workshop_name, total_refunded_sgd, attendees_refunded, actor_staff_id, actor_name }
5. enqueueEmail('admin_cancel_workshop', client.email, { workshop_name, refund_sgd }) per attendee
tx commit
```

The Stripe webhook `charge.refunded` arrives separately and updates `stripe_payments.status='refunded'`, `refunded_at`. If a refund call fails, the booking is still marked cancelled but `refund_outcome` stays as the optimistic `'stripe_refunded'` until reconciliation — admin sees the discrepancy via the failed `email` log + a future reports view.

### 3c. PT session scheduling (from a PT Request)

Triggered from `POST /pt-requests/:id/schedule` (admin or instructor).

**Credit accounting:** sessions are debited **at submit time** in `services/pt-sessions/request.ts:submitPtRequest` (1 session for 1on1, 2 for 2on1). The schedule path below does NOT touch credit balances — it just materialises the session. Cancellation, not scheduling, is the surface that returns credits (see §3c.cancel below).

```
services/pt-sessions/schedule.ts:schedulePtRequest({
  pt_request_id, instructor_id, location_id, room_id, starts_at, ends_at, actor_staff_id,
  capacity_online?, capacity_waitlist?, capacity_buffer?
})
  ↓
tx start
1. SELECT pt_requests FOR UPDATE WHERE id=X AND status='pending'
   → else 409 request_not_pending
2. For 2on1 requests: pt_requests.co_client_id MUST be NOT NULL
   → else 409 partner_account_required (admin must create the partner via /admin/clients first)
3. Conflict check: no class, workshop_day, or confirmed pt_session for instructor_id overlaps [starts_at, ends_at]
   → if conflict: 409 instructor_conflict
4. Room check: services/schedule/room-conflicts.ts (assertRoomInLocation + assertRoomAvailable)
5. Workspace check: location_id ∈ actor's granted_location_ids (superadmin bypasses)
6. Insert pt_sessions row: pt_request_id=X, instructor_id, location_id, room_id, starts_at, ends_at,
   session_type (copied from request), capacity_online (default 1 for 1on1, 2 for 2on1),
   lifecycle='active', scheduled_at=now(), scheduled_by_staff_id=actor_staff_id
7. Insert pt_session_clients rows: requesting client + co_client (if 2on1)
8. Insert bookings row(s): kind='pt', pt_session_id=new id, state='confirmed',
   credits_or_sessions_used=1 per client (recorded on the booking for audit; the debit
   itself already happened on submit and is not re-applied here); generate qr_token + code
9. Update pt_requests: status='scheduled', scheduled_pt_session_id=new id,
   resolved_at=now(), resolved_by_staff_id=actor_staff_id
10. enqueueEmail('pt_session_scheduled', client.email, { instructor_name, starts_at, location, room, qr_url })
    (and to partner if 2on1)
tx commit
```

#### 3c.cancel — Cancellation (`services/pt-sessions/cancel.ts:cancelPtRequest`)

Single entry point for both client cancel (`/me/pt-sessions/:id/cancel`) and admin cancel (`/pt-requests/:id/cancel`). Branches on current `pt_requests.status`:

```
tx start
SELECT pt_requests FOR UPDATE WHERE id=X

CASE status
  WHEN 'pending':
    1. Update pt_requests SET status='cancelled_before_scheduled',
                              resolved_at=now(), resolved_by_staff_id=actor (NULL for system/client)
    2. REFUND: increment client_packages.credits_or_sessions_remaining
       — 1 for 1on1, 2 for 2on1 — against the originating package.
    3. enqueueEmail('pt_cancelled_session_returned')

  WHEN 'scheduled':
    1. Update pt_requests SET status='cancelled_after_scheduled', resolved_at=now()
    2. Update pt_sessions SET lifecycle='cancelled', cancelled_at=now(),
                              cancelled_by_staff_id=actor (NULL for client/system)
    3. UPDATE every booking on the session: state='cancelled', refund_outcome='forfeited',
       cancelled_at=now()
    4. INSERT cancellations rows (kind='pt', source=client|admin, was_within_window=false,
       was_within_cap=true, refund_fired=false)
    5. INSERT inbox_items row (type='admin_cancel_class_pt') for the admin queue.
    6. enqueueEmail('pt_cancelled_forfeited')

  WHEN other (already terminal):
    no-op (idempotent)
END

tx commit
```

Expiry path (`pt-request-expiry` cron): pending requests past `expires_at` go through the same `'pending'` branch above with `actor=NULL`, ending up `cancelled_before_scheduled` + credits refunded. Client receives the `pt_cancelled_session_returned` email (subject mentions auto-expiry).

**Invariant:** `pt_sessions.pt_request_id` is `NOT NULL UNIQUE`. There is no path that creates a `pt_sessions` row without going through the schedule service.

### 3d. Manual credit / session adjustments

`POST /clients/:id/credits/adjust` and `/sessions/adjust`:

```
services/packages/adjust.ts:adjust({ client_id, client_package_id, delta, reason, acted_by_staff_id })
  ↓
1. SELECT client_packages FOR UPDATE WHERE id=X AND client_id=Y
2. new_balance = credits_or_sessions_remaining + delta
3. If new_balance < 0: 422 negative_balance — adjust would leave a negative credit count
4. Update client_packages.credits_or_sessions_remaining = new_balance
5. Insert manual_adjustments row: { client_id, client_package_id, delta, reason, acted_by_staff_id }
6. audit_log: action='client.credit_adjusted', payload contains delta + new balance
```

The negative-balance check is enforced in service AND as a DB CHECK — defence in depth (per §4i Ledger).

### 3e. Marketing edit

Trivial: `PATCH /marketing` updates the singleton; the public read endpoint (`GET /api/v1/public/marketing`) serves it directly with HTTP cache headers (`Cache-Control: public, max-age=60`). No CDN purge — 60-second propagation is acceptable for marketing copy.

### 3f. Corporate request scheduling (from a corporate request)

Triggered from `POST /corporate-requests/:id/schedule`. Reuses the existing corporate-session create logic — same room/instructor conflict checks as any scheduled session.

```
services/corporate/schedule.ts:scheduleCorporateRequest({
  corporate_request_id, main_instructor_id, supporting_instructor_ids?,
  location_id, room_id, starts_at, ends_at, actor_staff_id
})
  ↓
tx start  (FKs are DEFERRABLE INITIALLY DEFERRED — the circular request↔session refs settle at commit)
1. SELECT corporate_requests FOR UPDATE WHERE id=X
   → else 404 request_not_found; if status != 'pending' → 409 not_pending
2. Load corporate_packages → 404 package_not_found; if status='archived' → 422 package_archived
3. Validate body: ends_at > starts_at → else 400 bad_time_range;
   main_instructor_id ∉ supporting_instructor_ids → else 400 main_in_supporting
4. Conflict checks (reused corporate-session create logic):
   - room clash across classes / workshop_days / pt_sessions / corporate_sessions → 409 room_conflict
   - instructor (main + supporting) overlap → 409 instructor_conflict
5. Insert corporate_sessions: corporate_request_id=X, main_instructor_id, location_id, room_id,
   client_name (derived from the request's member record), starts_at, ends_at,
   lifecycle='active', scheduled_at=now(), scheduled_by_staff_id=actor
   + corporate_session_instructors rows for each supporting instructor
6. Update corporate_requests: status='scheduled', scheduled_corporate_session_id=new id,
   resolved_at=now(), resolved_by_staff_id=actor
tx commit  → 201
```

**Cancel** (`/corporate-requests/:id/cancel`): `pending` → `cancelled`; `scheduled` → `cancelled` + the linked `corporate_sessions` row is cancelled (`lifecycle='cancelled'`). **Mark attended** (`/corporate-requests/:id/attended`): `scheduled` → `attended`. Both set `resolved_at` / `resolved_by_staff_id`. There is no approve/decline — scheduling is the implicit approval.

---

## 4. Instructor endpoints — `routes/portal/instructor/*`

Scoped to the authenticated instructor. The middleware loads `staff_users` then resolves `instructors.staff_user_id` and stores it on the Hono context as `ctx.instructor_id`.

### `schedule.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/schedule` | All `classes` + confirmed `pt_sessions` + `workshops` where the instructor is assigned, with `event_state` computed |
| GET | `/schedule/today` | Same, filtered to today (SGT) |

### `roster.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/sessions/:kind/:id/roster` | Rosters for own sessions only — service rejects with `403` if the session's instructor is not `ctx.instructor_id` |

### `check-in.ts`
| Method | Path | Effect |
|---|---|---|
| POST | `/check-in/scan` | Same as admin scan, but service-layer guard enforces ownership |
| POST | `/check-in/manual` | Same |

### `pt-requests.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/pt-requests` | All pending PT requests (workspace-agnostic). The request no longer carries an instructor preference — instructors see the full pending queue and pick up the ones they can run, same as admins. |
| POST | `/pt-requests/:id/schedule` | Same shape as the admin route — `services/pt-sessions/schedule.ts:schedulePtRequest()`. The service forces `instructor_id = ctx.instructor_id` on this surface. |
| POST | `/pt-requests/:id/cancel` | Same shape as admin cancel — branches on current status per §3c.cancel. |

### ~~`availability.ts`~~ — REMOVED

Per `admin-restructure.md` §8, the Availability system is gone. Conflict checks happen at PT session scheduling time against `classes`, `workshop_days`, and confirmed `pt_sessions` for the instructor — no stored availability calendar.

### `profile.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/profile` | Own `instructors` row + name from `staff_users` |
| PATCH | `/profile` | Update bio, phone override, photo (R2 presigned upload). Eligible class types not editable — that's an admin operation. |

---

## 5. What lives in the spine, not here

These belong to `backend-architecture.md` and are referenced from the portal flows above without redefinition:

- **DB schema** — every table referenced (clients, staff_users, bookings, etc.) is defined in spine §3.
- **Audit middleware behavior** — spine §6.
- **Booking code + QR token generation** — spine §6 (`services/bookings/qr.ts`).
- **Event state computation** — spine §6 (`services/policy/event-state.ts`).
- **Cancellation evaluation algorithm** — spine §6 (`services/policy/evaluate-cancellation.ts`); the portal admin path bypasses it (see §3b).
- **Stripe webhook handlers + receipt URL population** — spine §4 (External integrations).
- **SMTP transport** — spine §4.
- **Background job schedulers** (`checkin-nag`, `credit-expiry`) — spine §5.
- **Migrations + seed** — spine §7.

---

## 6. Open portal-side questions

1. **Multi-instance feature-flag invalidation.** v1 toggles update the local cache only. If we deploy >1 HTTP instance behind a load balancer, toggles will be inconsistent for up to one boot cycle per instance. Acceptable for v1 (single-instance) — revisit when scaling out.
2. **Workshop refund failure recovery.** v1 inline-retry-3x is best-effort. A manual reconciliation report listing `bookings WHERE refund_outcome='stripe_refunded' AND no corresponding stripe_payments.refunded_at within 24h` is a useful add — deferred to phase 2 reports module.
3. **Audit-log surfacing UI.** Spine writes to `audit_log`; admin read views are deferred (`admin-restructure.md` §19).
