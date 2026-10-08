# Backend — Portal (`fe-portal`)

The staff-side backend surface. Implements the admin and instructor scopes of the staff app. Reads from `admin-restructure.md` for **behavior**; this doc maps that behavior onto routes, services, and database tables defined in `backend-architecture.md`.

- Spine: `backend-architecture.md` (stack, folder structure, full DB schema, integrations, jobs, shared cross-cutting).
- Behavior source of truth: `admin-restructure.md`.
- Sister doc: `be-client.md` (client surface).

---

## 1. Mount & Auth

```
/api/v1/portal/admin/*       — require staff session + role in {admin}
/api/v1/portal/instructor/*  — require staff session + role in {instructor, admin}
```

Both subtrees mount under `routes/portal/index.ts`, which applies a single `staffAuth` middleware (`middleware/staff-auth.ts`: reads a Better Auth `staff` pool bearer session, checks its Tenant claim is this studio, loads the `staff_users` row linked by `auth_user_id`, and resolves the caller's **Instructor Permissions** — every one for an admin, the `instructors.permissions` array for an instructor, read fresh on each request; `be/docs/adr/0011`). Role-specific gates live on the subtrees:

```ts
const portalRoutes = new Hono()
  .use('*', staffAuth, requireActiveStaff)
  .use('*', auditMiddleware)
  .route('/admin',      adminRoutes)        // .use('*', requireRole('admin'))
  .route('/instructor', instructorRoutes);  // .use('*', requireRole('instructor', 'admin'))
```

`requireActiveStaff` rejects any `staff_users.status` not equal to `'active'` (i.e. `pending` or `archived`). A member or platform session presented to `/portal/*` is a row the staff pool has never seen: 401 `invalid_token`. A staff session signed in at another studio is a row this studio's context cannot see, since logins are per studio (ADR 0006): 401 `invalid_token`. A session whose claim names another studio would be 403 `tenant_mismatch`, the belt to Row-Level Security's braces.

`auditMiddleware` writes one `audit_log` row per successful mutating request (`POST | PUT | PATCH | DELETE`). Idempotent reads do not audit.

### Workspace scoping & role gates

There are exactly two staff roles, **admin** and **instructor**, ranked admin > instructor. Every router under `/portal/admin/*` is gated `requireRole('admin')`: there is no higher staff role and no read-only admin mode, so admins write to Clients, Workshops and Rooms like every other surface. A 403 from a role gate carries `required: ['admin']`. (The **platform administrator** who signs in to the super portal and calls `/api/v1/platform/*` is not a staff role and never reaches these routes.)

**Instructor Permissions** (`be/CONTEXT.md` § Staff, `be/docs/adr/0011`). Within the instructor role, three switches an admin sets per person — `schedule_classes`, `take_pt_bookings`, `manage_rosters` — each gating a bundle of instructor routes with `requirePermission(key)` (`middleware/require-permission.ts`), applied per route beside the role gate in §4. A refusal is `403 forbidden_permission { required: '<key>' }`. The role gate runs first, so a non-staff caller sees the role refusals unchanged; the permission gate runs before the service, so it is answered before any ownership check (`not_main_instructor`, `not_your_session`). Admins hold every permission and are never refused by one. `GET /auth/me` returns `permissions: string[]` — the granted keys for an instructor, all three for an admin — so the portal learns them with the staff identity. Every existing and newly invited instructor has all three unless the invitation says otherwise. What is gated per route is in §4; all three are enforced: `schedule_classes` (#328), `take_pt_bookings` (#330) and `manage_rosters` (#331).

Per `admin-restructure.md` Overview, admin surfaces partition into three buckets, which differ only in how they filter by location:

| Bucket | Surfaces | Gate |
|---|---|---|
| **Global** | Locations, Rooms, Class Types, Class Packages, Workshops, PT Packages, Promotions, Promo Codes, Global Policy, Notifications, Waiver, Staff | `requireRole('admin')` on the entire router |
| **Workspace-scoped** | Schedule, Check-in, Inbox | `requireRole('admin')`. Reads filter to the location the portal has selected as the active workspace; any active location may be selected. |
| **Workspace-agnostic** | PT Requests, Clients | `requireRole('admin')`. No location filter. |

**Location grants are retired.** There is no per-staff location allow-list: `granted_location_ids` is not set on invite, edit or invitation accept, and the column is dropped. An admin sees and writes to every active location; the workspace is a view filter, not a permission.

### Maintenance

While the platform's **Maintenance mode** is on (be/CONTEXT.md § Maintenance mode), every `/api/v1/portal/*` call, every `/api/v1/public/*` call the portal makes (the staff sign-in step included) and the `staff` pool's own routes (`/api/v1/auth/staff/*` — sign-in, session reads, password reset) answer, before any auth or Tenant resolution:

```
503 Service Unavailable
Retry-After: 30
{ "error": "maintenance", "message": "<the platform's message>" }
```

No staff role, impersonation or studio is exempt. fe-portal replaces a studio's portal with a full-page screen showing `message` and re-checks `GET /api/v1/public/maintenance` (`200 { "maintenance": false }` once it is off) about every 30 seconds, reloading into the portal when it gets through. The super portal is never closed: `/api/v1/platform/*` and `/api/v1/auth/platform/*` stay open, and the switch itself is there:

| Method | Path | Effect |
|---|---|---|
| GET | `/api/v1/platform/maintenance` | `{ enabled, message, updated_by, updated_at }` — `updated_by` is the operator's email, both null until anyone has switched it. Read fresh, not from the gate's cache. |
| PUT | `/api/v1/platform/maintenance` | `{ enabled: boolean, message?: string }` (message trimmed, 1–500 characters; omitted keeps the stored one). Records the operator and the time; takes effect in this process at once and in any other within a few seconds. A blank message is `400`. Like every platform route, `404` to anyone not on `PLATFORM_ADMIN_EMAIL`. |

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
| GET | `/locations/:id/live-unlimited-count` | — | `{ count }` — live Unlimited Plans whose Home Location is this one (§6's reading of live: active, and Dormant or unexpired). Informational: the archive confirmation names it, it never blocks. |
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

**Scheduling integration.** `room_id` is now a **required** field on the create/reschedule paths for classes (`schedule.ts → POST /schedule/classes`), workshop days (`workshops.ts → POST/PATCH /workshops/:id/days`), and PT sessions (`pt-sessions approve`). The service layer validates the room belongs to the session's location (`400 room_location_mismatch` / `400 room_archived` / `404 room_not_found`) and that it is clash-free — two active sessions can't share a room at overlapping times, checked across all four event kinds. The same check covers instructors: nobody on the roster, main or supporting, may already be booked in that window. Either way a clash returns `409 schedule_conflict` with `{ subject, subject_id, message, conflicts: [{ kind, id, starts_at, ends_at }] }`, where `message` is the admin-facing sentence naming who is taken and by what.

### `class-types.ts`
Same CRUD shape as locations. Archive is blocked if any non-archived `instructor_class_types` references the type, or any active future `classes` / `workshops` reference it.

### `instructors.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/instructors` | List with `?status=pending|active|archived`, joins `staff_users` |
| GET | `/instructors/:id` | Detail incl. `instructor_class_types` eligibility, photo presigned URL |
| POST | `/instructors` | Create `staff_users` row (role=`instructor`, status=`pending`) + `instructors` row + `instructor_class_types` rows + auto-fires staff invitation (see §3a) |
| PATCH | `/instructors/:id` | Update bio, phone override, eligible class types. Photo upload via presigned R2 PUT URL flow (see `backend-architecture.md` §6c). |
| POST | `/instructors/:id/archive` | Set `staff_users.archived_at` and delete the instructor's Better Auth sessions at this studio (`endStaffSessionsAt`). Blocks on active future sessions where this instructor is assigned. |
| POST | `/instructors/:id/resend-invite` | Re-issue invitation (§3a) — only if `status='pending'` |

### `policy.ts`
| Method | Path | Body | Effect |
|---|---|---|---|
| GET | `/policy` | — | `{ global_policy, pt_booking_config }` |
| PATCH | `/policy/global` | `{ cancel_cap_enabled, cancel_cap_count, cancel_cap_cycle_days, class_window_hours, pt_window_hours }`, each optional | Update singleton row. `cancel_cap_enabled` (#318) switches the Cancellation Cap; off, every in-time member cancel returns and the count and cycle are kept but unread. `GET /policy`'s `global_policy` carries it too |
| PATCH | `/policy/pt` | `{ book_in_advance_days?, min_book_in_advance_days? }` (either or both, 1..365) | Update singleton row. A minimum above the maximum, counting the stored value of whichever is omitted, is 400 `min_book_in_advance_after_max` |

### `class-packages.ts` (admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/class-packages` | List with `?status`, `?kind=credit_bundle\|unlimited\|trial`. Default sort: trial first, then credit_bundle, then unlimited (matches fe-client `/packages` ordering). |
| POST | `/class-packages` | Insert `class_packages` row. CHECK constraint enforces kind-specific column requirements (credits + validity_days for `credit_bundle`; duration_months for `unlimited`; credits + validity_days for `trial`). |
| PATCH | `/class-packages/:id` | Edit name, description, status. Price changes apply to **future** purchases only — existing `client_packages` rows are immutable. |
| POST | `/class-packages/:id/archive` | Soft delete; existing client_packages remain valid until `expires_at`. |

**Trial Pass semantics.** `kind='trial'` is just another row — there is no separate route. The one-per-client gate lives at purchase time (`be-client.md` §4e), enforced by the `client_packages(client_id) WHERE kind='trial'` unique partial index. Admin **may** publish multiple active Trial Pass definitions (e.g. for A/B testing), but a single client can hold at most one across all of them.

### `pt-packages.ts` (admin)
Same shape as class-packages, with PT-specific fields. Adds `description` column edits.

### `promotions.ts` (admin — `admin-restructure.md` §5d, §19, `fe-client-features.md` §6.1)

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

### `promo-codes.ts` (admin — `spec-pre-launch-batch.md` §9–§11)

**Not nested, unlike `promotions.ts` above.** A Promotion belongs to exactly one product so its editor lives inside that product's dialog; a Promo Code crosses products and cannot, so it gets a top-level router and a page of its own under Packages. Rules live in `services/packages/promo-codes.ts` (pure — refusals returned, not thrown); the database half is `services/packages/promo-code-admin.ts`.

| Method | Path | Effect |
|---|---|---|
| GET | `/promo-codes` | List, `?status=active\|archived`. Each row carries `redemption_count` and `terms_frozen`. |
| GET | `/promo-codes/products` | The products a code may be scoped to. **Corporate packages are absent entirely** — not an unchecked box. Workshops appear at workshop level, never tier. |
| GET | `/promo-codes/:id` | One code with its scope rows |
| POST | `/promo-codes` | `{ code?, label, kind: 'percent'\|'amount', percent_off?, amount_off_sgd?, max_redemptions?, expires_at?, applies_to_all, products[] }`. Omit `code` and one is generated from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (8 chars, no `0`/`O`/`1`/`I`/`L`), retrying on the unique violation. Custom text is normalised (trimmed, upper-cased) and must match `^[A-Z0-9-]{3,24}$`. `max_redemptions` and `expires_at` are independently nullable — all four combinations are legal. |
| PATCH | `/promo-codes/:id` | Label, expiry, cap and product list are editable for the code's whole life. `code` / `kind` / `percent_off` / `amount_off_sgd` are accepted **only until the first Redemption**, then `409 promo_code_terms_frozen` — changing either rewrites terms a member has accepted. |
| POST | `/promo-codes/:id/archive` | Refuses new Redemptions and leaves held places to lapse. The row is never deleted. |
| POST | `/promo-codes/:id/unarchive` | Back to `active` |

**Two invariants the database cannot hold, enforced in the service.** `applies_to_all = true` means *no* scope rows (`400 promo_code_scope_conflict` / `promo_code_scope_empty`) — it spans rows. And `promo_code_products.product_id` carries no foreign key, exactly like `promotions.parent_id`, so existence is checked at write (`400 promo_code_product_not_found`).

### `schedule.ts` (workspace-scoped)
| Method | Path | Effect |
|---|---|---|
| GET | `/schedule` | Unified timetable: union of `classes`, `workshop_days` (one tile per day with `Day N/M` chip per `admin-restructure.md` §7c), confirmed `pt_sessions`. **Filtered to the active workspace location.** Query filters: `?instructor_id`, `?class_type_id`, `?from`, `?to`, `?type=class\|workshop\|pt`. Each row carries `event_state` computed at read time per `services/policy/event-state.ts`. `capacity` is **attendance capacity** (`capacity_online + capacity_buffer`; the waitlist is not a seat — `admin-restructure.md` §7d). Class rows add `attendance_capacity`, `online_used`, `buffer_used`, `overbook_used` and `attending` (every confirmed booking, also `booked_count`), and `waiting` (members in the class's live waitlist; the cell shows "+N waiting"); those six are `null` on every other kind. |
| GET | `/schedule/classes/:id` | Class detail. Carries the same five seat fields, and each `attendees[]` row its `seat` (`online` \| `buffer` \| `overbook`) and `promoted_from_waitlist` (the booking is some `waitlist_entries.booking_id`), and `cancel_preview` — `{ credits, package_name, unlimited, late }` for the staff cancel dialog (#320; `late` = inside the class's effective window), null on a row that cannot be cancelled (no-show, attended); `services/bookings/staff-cancel-preview.ts`. `attendees[]` holds confirmed and no-show bookings only; **`cancelled_bookings[]`** (#352) holds the ones cancelled off the class, newest cancellation first — on a cancelled class, everyone who was booked: `{ booking_id, client: { id, name }, credits_used, cancelled_at, cancelled_by, cancelled_by_name, late, outcome, who_line, outcome_line }`, the shared cancellation summary as on `GET /clients/:id`. A cancelled booking is never checked in (`409 booking_cancelled`). Every count is `services/bookings/seats.ts`. The waitlist (spec-waitlist §10): `waiting`, `waitlist_enabled` (the studio switch — off, the line still lists and can be worked) and `waitlist[]` in queue order `(joined_at, id)`: `{ entry_id, position, client: { id, name }, joined_at, payment_status }`, where `payment_status` is `{ status: 'pending', package_name }` or `{ status: 'cannot_pay', reason }` — the member's **Default payer** (be/docs/adr/0010) worked out at read time, nothing written. `services/waitlist/staff.ts:waitlistPanel`. |
| POST | `/schedule/classes/:id/waitlist` | Put a member in a full class's line from Add member's prompt (spec-waitlist §7). Body `{ client_id }`. The member's own join (`services/waitlist/entries.ts:join`) with the same refusals in the same order (`waitlist_disabled`, `waitlist_closed`, `already_booked`, `already_waitlisted`, `class_not_full`, `waitlist_full`, the package-selection codes), plus `404 client_not_found`. `201 { entry_id, position }`; the staff member is the audit record. |
| POST | `/schedule/classes/:id/waitlist/:entryId/promote` | **Add to class** (spec-waitlist §7). Body `{ overbook?: boolean }`. Books that waiting member whatever the Cancellation Window says: a free **online** seat, else a **buffer** seat, else an **overbook** seat when `overbook: true`. Paid for by the member's **Default payer** (be/docs/adr/0010); the entry becomes `promoted` with `booking_id` and `resolved_by` = the staff id. The `class_waitlist_promoted` email goes only while the class is still outside the window (its free-cancel promise holds). `201 { booking_id, seat, qr_token, code, paid_with: { client_package_id, name, kind } }` — `paid_with` names the package charged. Refusals: `409 class_full { waitlist_open, waiting, capacity_waitlist }`; the package-selection codes (the member stays `waiting`); `409 already_booked`; `400 class_already_started`; `404 class_not_found` / `waitlist_entry_not_found`. |
| DELETE | `/schedule/classes/:id/waitlist/:entryId` | **Remove** a waiting member: the entry becomes `removed`, `resolved_by` = the staff id; everyone behind moves up. `204`; `404 waitlist_entry_not_found` when it is no longer waiting. |
| GET | `/schedule/classes/:id/packages?client_id=` | The member's class packages read against this class (#333) — what Add member's **Pay with** select lists. `200 { default_client_package_id, packages: [{ id, name, kind, running, remaining, expires_at, activation_end_if_picked, location, eligible, reason }] }`: the member Book sheet's `my_packages` shape (`services/bookings/book.ts:staffPackagesForClass`), every live class-family package in default order, each `eligible` or with its `reason`, a Dormant one with the end date picking it would stamp; `default_client_package_id` is the **Default payer**. Read-only. `404 class_not_found` (not active, or another studio's) / `client_not_found` (another studio's member, or blocked). |
| POST | `/schedule/classes/:id/bookings` | Book a member onto the class (spec-waitlist §7). Body `{ client_id, overbook?: boolean, client_package_id?: uuid }`. The member's booking in every respect — package selection, debit, Activation, QR — except the seat: a **buffer** seat while one is free, else an **overbook** seat when `overbook: true`. `client_package_id` is staff's pick of the member's packages (#333), under the member's own rule: it pays if it is Eligible, and is refused with its own reason if not, even when another package could pay; `404 client_package_not_found` when it is not one of the member's live class packages. Absent, the member's **Default payer** pays (be/docs/adr/0010) — running soonest-ending first, then Dormant with Unlimited Plans before credits. `201 { booking_id, seat, qr_token, code, paid_with: { client_package_id, name, kind } }` — `paid_with` names the package charged. Refusals: `409 class_full { waitlist_open, waiting, capacity_waitlist }` (buffer full and no overbook; with `waitlist_open` the portal offers "Add to waitlist" — `POST …/waitlist` below); `409 time_clash { client_id, client_name, clash }` — the member holds a booking whose time overlaps the class; the portal asks "Book anyway?" and retries with `allow_clash: true`, which admins and instructors may both send and the audit row records as `payload.detail.allow_clash` (`class-booking-lifecycle.md` §3.6). The same `time_clash` / `allow_clash` pair is on `POST …/waitlist`, `POST …/waitlist/:entryId/promote`, PT scheduling (`POST /pt-sessions/:id/schedule`, `POST /pt-sessions/manual`, `POST /pt-sessions/sessions/:id/members`, `PATCH /pt-sessions/sessions/:id` when it moves or gains a partner) and the instructor's own PT routes; `409 already_booked`; the package-selection codes `insufficient_credits` / `location_not_covered` / `plan_expires_before_class` / `not_accepted`; `400 class_already_started`; `404 class_not_found` / `client_not_found` (a member of another studio, or blocked). |
| POST | `/schedule/classes` | Create class instance. Body includes `capacity_online`, `capacity_waitlist`, `capacity_buffer` (the structured capacity per `admin-restructure.md` §7d) and optional `instructor_pay_sgd` (pay to the main instructor — see `payroll.ts`). `location_id` must be an active location. |
| PATCH | `/schedule/classes/:id` | Edit (rejects if any confirmed bookings AND material change, e.g. moving start time more than 15 min). Lowering `capacity_online` below the **online** seats taken is `409 capacity_below_bookings { confirmed }`; buffer and overbook seats don't count against it. |
| POST | `/schedule/classes/:id/cancel` | Admin cancellation — see §3b |
| GET | `/schedule/pt/:id` | Private session detail: time, type, instructor and pay, supporting instructors, Location, room, capacity, `pt_request_id` (what cancelling posts against), `origin` (`portal` for a manual session staff added, `member` for a request, null once the requester is deleted) and `clients[]`: `{ id, name, code, check_in_state, is_requester, package: { id, name, sessions_left } \| null }` — `package` is the one paying their seat as it stands now, and a member removed and added back is listed once, by their confirmed booking (#338). `services/schedule/detail.ts:getPtSessionDetail`, serialized by `routes/portal/pt-session-detail.ts`. `404 pt_session_not_found`. |
| POST | `/schedule/series/preview` | **Class Series** preview. Body: `class_type_id`, `main_instructor_id`, `instructor_pay_sgd`, `supporting_instructors: [{ instructor_id, pay_sgd }]`, `location_id`, `room_id`, `weekday` (ISO 1 = Mon … 7 = Sun), `start_time` / `end_time` (`HH:MM`, Tenant-local), capacity triple, `credit_cost`, `first_date` / `last_date` (`YYYY-MM-DD`, at most a year apart), `excluded_dates`. Returns `{ dates: [{ date, starts_at, ends_at, clashes }], clash_count }` — `clashes` are `schedule_conflict` payloads (room, instructor, leave). |
| POST | `/schedule/series` | Commit the same body: re-checks every date in one transaction and creates all classes (each with `series_id`) or none — `409 series_conflict { dates }`. Skipped dates are `excluded_dates`. `201 { series, class_ids }`. |
| GET | `/schedule/series/:id` | The series template, `last_date`, `excluded_dates`, `ended_from`. |
| POST | `/schedule/series/:id/extend/preview` | `{ last_date, excluded_dates? }` → the new dates after the current last date, with clashes. Dates that already have a class of the series are never offered. |
| POST | `/schedule/series/:id/extend` | Commit the extend, all or nothing. Safe to repeat. `409 series_ended` once ended. |
| POST | `/schedule/series/:id/end` | `{ from_date }` → cancels the series' unbooked classes from that date and returns `{ ended_from, cancelled_class_ids, booked_classes: [{ class_id, starts_at, booked_count }] }` for the admin to cancel through `/schedule/classes/:id/cancel`. |
| POST | `/schedule/workshops/:id/cancel` | Admin cancellation of an entire workshop (all days, all tiers) + Stripe refund fanout to attendees — see §3b. **No** workshop create/edit here; those live in `workshops.ts`. |
| GET | `/schedule/workshops/picker` | Lists workshops in the active workspace that have at least one future `workshop_day`. Powers the "+ Workshop" picker in the scheduler per `admin-restructure.md` §7c — selecting from this list **does not create anything**; it just navigates to the workshop's days. |

Series create (preview and commit) is also on the instructor schedule (§4); extend and end are admin only. The body's wire shape is shared by both mounts in `routes/portal/class-series.ts`.

**Per-class Cancellation Window** (#313, `be/CONTEXT.md` § Cancellation Window). `POST /schedule/classes`, `PATCH /schedule/classes/:id` and `POST /schedule/series` (and its preview) take an optional `cancel_window_hours`: whole hours from 0, the same bound as the Policy page's class window. Blank (omitted or `null`) on create follows the studio's window; on `PATCH`, omitted leaves it alone and an explicit `null` puts the class back on the studio's. A series copies its value onto every class it creates and every class an extend adds. Class rows — create, update, `GET /schedule/classes/:id`, and the instructor's create and roster — return `cancel_window_hours` (the class's own, nullable) and `effective_cancel_window_hours` (the one that applies now); series rows return `cancel_window_hours`. The instructor's `POST /schedule/classes` takes the same optional field.

**Package rule** (#323, `be/CONTEXT.md` § Package rule). `POST /schedule/classes`, `PATCH /schedule/classes/:id`, `POST /schedule/series` and its preview, and the instructor's `POST /schedule/classes` and series take an optional `package_rule: { mode: 'all' | 'only' | 'except', package_ids: uuid[] }` naming exact catalogue class packages, archived ones included. Omitted on create is *accepts all*; on `PATCH`, unchanged. `only` with no packages is `400 package_rule_empty`; a package that is not one of this studio's class packages (a PT or corporate package, another studio's, an unknown id) is `400 package_rule_invalid_package` with the offending `package_ids`. `PATCH` with `preview: true` writes nothing and answers `{ would_cancel: n }` — the confirmed bookings on the class (never one already checked in) paid by a package the new rule refuses. Without it, the rule is saved and exactly those bookings are cancelled in the same transaction through the single-booking cancel with the studio-initiated reason `package_rule_changed`: refunded in full to the package that paid, the seat offered to the waitlist, not counted against the member's cancellations; each member is emailed `class_rule_cancelled` after commit. A series copies its rule onto every class it creates and every class an extend adds; editing one class's rule never reaches the series. `PUT /schedule/series/:id/package-rule` (admin, body `{ mode, package_ids }`) changes the series' own rule, which reaches only the classes it adds from then on; the classes it already made keep theirs, so it previews nothing and cancels nothing. Class rows (create, update, `GET /schedule/classes/:id`, the instructor's create and roster) and series rows return `package_rule: { mode, packages: [{ id, name, kind, archived }] }`. The picker's list: admins read `GET /class-packages`; instructors `GET /portal/instructor/catalog/class-packages` → `{ class_packages: [{ id, name, kind, status }] }`, archived included, no prices. Staff booking a member and staff promoting from the waitlist refuse `409 not_accepted` when the class accepts nothing the member holds; the waitlist panel's `payment_status.reason` can be `not_accepted`.

### `merch.ts` (global)

Studio goods the member pays for online and collects in person. No stock count, no location, no fulfilment state: the `merch_orders` row IS the purchase history line the front desk hands the item over against. Admins manage it like every other global surface.

| Method | Path | Effect |
|---|---|---|
| GET | `/merch` | List merch, title-ordered. `?include_archived=true` to include archived rows (the page shows both). |
| POST | `/merch` | `{ title, description?, price_sgd }`. Returns the row; the photo is a follow-up call. |
| PATCH | `/merch/:id` | Edit any of the above, plus `{ archived: boolean }` — archiving hides the item from `/public/merch` and refuses new checkouts. |
| POST | `/merch/:id/image` | Multipart, field name `file`. JPG/PNG/WebP, max 5MB — checked server-side after `bodyLimit` refuses an oversized body (400 `invalid_request` when the body is not `multipart/form-data`, 400 `image_required` when it carries no file, 413 `image_too_large`, 400 `image_type_not_allowed`, 400 `image_empty`, 422 `image_storage_unavailable` when R2 is unconfigured). Key is deterministic (`merch/<id>.<ext>`), so re-uploading replaces rather than orphans, and it is written only after the object is in the bucket. |
| DELETE | `/merch/:id` | Hard delete — nothing references a merch row (`merch_orders.merch_id` is `ON DELETE SET NULL`, and the order keeps its frozen `title`/`amount_sgd`). |

### `workshops.ts` (workspace-scoped — `admin-restructure.md` §19, `fe-client-features.md` §4.1)

Workshops are configured under Packages (not Schedule). Three-stage editor: **Basics → Days → Tiers**. Workshop's `location_id` is fixed at creation; admin sees only their workspace's workshops.

| Method | Path | Effect |
|---|---|---|
| GET | `/workshops` | List workshops in the active workspace (filtered to the selected location). `?status=active\|cancelled`, `?has_future_days=true`. |
| GET | `/workshops/:id` | Detail with `days[]`, `tiers[]`, `tier_days{}`, `images[]`, `instructors[]`, `promotions[]`. |
| POST | `/workshops` | **Basics stage** — `{ name, description_html, class_type_id, location_id, instructor_ids[], cover_r2_key?, images[]? }`. Returns the workshop id; days + tiers added in follow-up calls. `location_id` must be an active location. |
| PATCH | `/workshops/:id` | Edit basics. `location_id` is **immutable** once `workshop_days` exist (changing workspace mid-flight is unsafe). |
| POST | `/workshops/:id/cancel` | Admin. Same as `schedule.ts:POST /schedule/workshops/:id/cancel` — exposed here too so the cancel action is reachable from the workshops surface. |
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

### `pt-requests.ts` (workspace-**scoped** — `admin-restructure.md` §9)

PT requests are the actionable entity. **No back-and-forth in app — all negotiation is on WhatsApp.** The portal exposes exactly two terminal actions: **schedule** (the implicit approval) and **cancel**. There is no decline-with-note path and no approve button.

PT requests carry a `location_id` chosen by the client at submission time, so the triage queue is **workspace-scoped** — the portal scopes the list to the staff's active workspace location, and any admin may select any active location.

| Method | Path | Effect |
|---|---|---|
| GET | `/pt-requests` | Triage queue, **filtered to the active workspace location**. Default `?status=pending`, ordered `created_at desc`. Filters: `?status`, `?location_id`, `?class_type_id`, `?client_id`, `?session_type`, `?from`, `?to`. |
| GET | `/pt-requests/:id` | Detail incl. client profile snapshot, class type, all proposed slots (`pt_request_slots`), co-client (resolved `co_client_id` OR free-text `co_client_name + co_client_email`), message, expiry. |
| POST | `/pt-requests/:id/schedule` | Convert request → `pt_sessions` row. Body: `{ instructor_id, location_id, room_id, starts_at, ends_at, instructor_pay_sgd?, note?, capacity_online?, capacity_waitlist?, capacity_buffer? }` (`note`, ≤500, is stored trimmed as `schedule_note` for the member to read; the portal offers it when the time is none of the proposed slots) (`instructor_pay_sgd` = pay to the instructor — see `payroll.ts`). Calls `services/pt-sessions/schedule.ts:schedulePtRequest()` — see §3c. `location_id` must be an active location. **For 2on1 requests with no `co_client_id` yet** the call rejects with 409 — admin must create the partner's client first via the portal's Customers page (`/admin/customers`, API `/portal/admin/clients`), the FE then re-opens the schedule dialog with `co_client_id` resolved. |
| POST | `/pt-requests/manual` | **Manual session** (#334) — a private session with no member request behind it (mounted at `/portal/admin/pt-sessions/manual`). Body: `{ session_type: '1on1'\|'2on1', instructor_id, location_id, room_id, starts_at, ends_at, instructor_pay_sgd?, members: [{ client_id, client_package_id? }], override? }`. `services/pt-sessions/manual.ts:createManualPtSession` writes a `pt_requests` row itself — `origin = 'portal'`, `created_by_staff_id` = the actor, client = first member, co-client = second, `status = 'scheduled'`, no slots, `expires_at` null, no `debited_client_package_id` — and schedules it into the session in the same transaction, so every session still has a request. `members`: one for a 1on1, up to two for a 2on1, never none (`400 invalid_request`; `409 already_booked` for a duplicate, `409 session_full` for too many). **Each attendee pays one session from their own package**, recorded on their booking (`client_package_id`, `credits_or_sessions_used = 1`); `client_package_id` names it, absent the PT Default payer pays (the session's type first, running before Dormant, soonest-ending first). The pure rule `services/pt-sessions/seat.ts:mayPayForSeat` decides: refused `409 not_a_pt_package` / `package_expired` / `insufficient_pt_credit` / `package_not_consumable`; warned `session_type_mismatch` and `bound_to_other_instructor` — `409 seat_needs_override { warnings, client_id, client_package_id }` unless `override: true`. Also `404 client_not_found` (another studio's, or deleted), `409 client_blocked`, `404 client_package_not_found`, and the room/instructor refusals of scheduling a request (`400 room_location_mismatch`, `409 schedule_conflict`). A Dormant package Activates on its seat (be/docs/adr/0011). The room and instructor are held under a transaction-scoped advisory lock and re-checked, so two creates of one slot make one session. `201 { pt_request }`, the request carrying `origin: 'portal'` and its `session`. Every request row now carries `origin` (`member` \| `portal`), and `expires_at` is null on a `portal` one. |
| POST | `/pt-requests/sessions/:id/members` | **Add a member to a manual session** (#337; mounted at `/portal/admin/pt-sessions/sessions/:id/members`, `:id` the `pt_sessions` id). Body: `{ client_id, client_package_id?, override? }`. `services/pt-sessions/manual.ts:addManualPtSessionMember` seats them exactly as the create does — one session from their own package, named or the PT Default payer, the same refusals and `409 seat_needs_override` warnings, a Dormant package Activated — and the request mirrors the roster (a second attendee becomes its co-client). A seat freed by a single-booking cancel can be filled again, by the same member or another: the session's attendee rows are brought back to who is booked, the request's client stays while booked, and the co-client is whoever else is (on a 1on1 whose member was cancelled, the new member becomes the client). Refused `404 pt_session_not_found` (another studio's), `409 session_cancelled`, `409 not_a_manual_session` (a member-origin session: its requester paid for the whole session, so a seat paid on its own has no place on it), `409 session_full` (a 1on1 with one attendee, a 2on1 with two), `409 already_booked`. The session row is locked, so two adds for the last seat are decided one after the other. `201 { booking: { id, client_id, client_package_id } }`. |
| GET | `/pt-requests/seat-candidates?client_id=&session_type=&instructor_id=` | **The packages a member could pay a seat with** (#337; mounted at `/portal/admin/pt-sessions/seat-candidates`). Takes the session's shape, not its id, so the form can ask before the session exists. `services/pt-sessions/manual.ts:listSeatCandidates`: every PT package the member holds, in the PT Default-payer order. `200 { default_client_package_id, packages: [{ id, name, session_type, sessions_left, expires_at, bound_instructor, eligible, reason, warnings, activation_end_if_picked }] }` — `eligible` with its `warnings` (`session_type_mismatch`, `bound_to_other_instructor`), or not with its `reason`; `activation_end_if_picked` the end date a seat would stamp on a Dormant one now; `default_client_package_id` the first eligible. Read-only. `404 client_not_found` (another studio's member, or deleted), `409 client_blocked` — refused as the add would be. |
| DELETE | `/pt-requests/sessions/:id/members/:clientId` | **Remove a member from a manual session** (#335; mounted at `/portal/admin/pt-sessions/sessions/:id/members/:clientId`). `services/pt-sessions/manual.ts:removeManualPtSessionMember` cancels that member's seat and returns its one session to their own package whatever the window (a staff cancel), records a `cancellations` row (`source` admin or instructor) and an `admin_cancel_class_pt` inbox item, and returns the package to Dormant if this session Activated it and the cancel is outside the PT window (be/docs/adr/0011). The others stay seated, the session stays active and its seat can be filled again; the attendee rows and the request's client / co-client follow who is booked. Refused `404 pt_session_not_found`, `409 session_cancelled`, `409 not_a_manual_session`, `404 booking_not_found` (not booked on it), `409 booking_attended` (checked in: attendance, not a refund) and `409 session_ended` (its end has passed — its sessions were used). The request row is locked before the session, the order the cancel takes them in. `200 { refund_outcome, refunded_sessions }`. |
| POST | `/pt-requests/:id/cancel` | Admin cancel. Optional body `{ note? }` (≤500): the reason, stored trimmed as `cancel_note` in the same transaction and shown to the member; blank is none. Branches on current status: `pending` → `cancelled_before_scheduled` + refund (1 session for 1on1, 2 for 2on1) to the originating client package; `scheduled` → `cancelled_after_scheduled`, cascade-cancel the linked `pt_sessions` row + every booking on it (state='cancelled', refund_outcome='forfeited'), **no refund** (v1 policy). Emits `admin_cancel_class_pt` inbox row and, after commit, emails the affected client(s): `pt_request_cancelled` on a member's request, `admin_cancel_pt` on a manual session (§3c.cancel). Idempotent — calling on an already-terminal request is a no-op. **A manual session** (#335, `origin = 'portal'`) is settled seat by seat: every booking still confirmed gets its one session back on the package it was paid from (`refund_outcome = 'session_returned'`), one `cancellations` row each, and each package this session Activated returns to Dormant unless the cancel is inside the PT window. |

**Changing a manual session's type** (#335). `PATCH /pt-requests/sessions/:id` with `session_type` on a manual session never goes through the request's debit: a 1on1 → 2on1 seats the partner (`co_client_id`, required — `400 partner_required`) on their own package exactly as adding a member does — `co_client_package_id` names it, absent the PT Default payer pays, the same refusals and `409 seat_needs_override` unless `override: true`; a 2on1 → 1on1 cancels whoever is not the request's client and returns their one session to their own package (and to Dormant if this session Activated it, in time). The other attendee's balance never moves, and their booking stays at `credits_or_sessions_used = 1`. Refused `409 session_ended` once the session is over, `409 booking_attended` for a leaving partner who was checked in, and `409 session_cancelled` for a session cancelled while the change waited on its lock. A member-origin session keeps the requester-pays change (PT-57..61).

Every row on both the list and the detail carries `bound_instructor` (`{ id, name }` or null) — the **Bound Instructor** of the package the request was debited from. The admin queue shows all requests with the binding visible; the schedule dialog pre-selects that instructor and allows an override.

### `pt-sessions.ts` — removed

Admin-side PT actions all flow through `/pt-requests/*`. Cancellation of a scheduled session goes via `POST /pt-requests/:id/cancel` (branches as documented above) so the request and session stay in lockstep. Listing scheduled `pt_sessions` for the schedule view is handled by `schedule.ts:listScheduleItems`.

### `corporate-requests.ts` (gated `requireRole('admin')`, like pt-requests)

Corporate moved from **admin-direct-create** (admin made a `corporate_sessions` row with a freeform client name on the schedule) to a **request-driven flow mirroring PT**. A member buys a corporate package; the Stripe webhook auto-creates ONE pending `corporate_requests` row (no client form — negotiation is on WhatsApp). The portal exposes **schedule** (the implicit approval — no approve/decline step), **cancel**, and **mark attended**.

The old "+ corporate" package dropdown and the `/admin/schedule/new/corporate` direct-create page are **removed**. Corporate sessions are now created **only** by scheduling a pending request (see §3f).

| Method | Path | Effect |
|---|---|---|
| GET | `/corporate-requests` | Triage queue. `?status=pending\|scheduled\|cancelled\|attended\|all` (default `pending`). |
| GET | `/corporate-requests/:id` | Detail. |
| POST | `/corporate-requests/:id/schedule` | Schedule the pending request → creates the `corporate_sessions` row (reuses the existing corporate-session create logic: room/instructor conflict checks), sets `corporate_request_id`, flips request to `scheduled`. Body: `{ main_instructor_id, supporting_instructor_ids?, location_id, room_id, starts_at, ends_at }` → 201. See §3f. |
| POST | `/corporate-requests/:id/cancel` | Cancel. `pending` → `cancelled`; `scheduled` → `cancelled` + cancels the linked `corporate_sessions` row. |
| POST | `/corporate-requests/:id/attended` | `scheduled` → `attended`. |

**Schedule errors:** `404 request_not_found` / `404 package_not_found`; `409 not_pending` / `409 schedule_conflict`; `422 package_archived`; `400 supporting_instructor_duplicates_main` / `400 invalid_instructor_id` / `400 bad_time_range`. The roster and conflict errors are the shared vocabulary all four event kinds return — see `services/schedule/roster.ts` and `services/schedule/occupancy.ts`.

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
| POST | `/bookings/:id/cancel` | Staff cancel of one member's class booking (#320). Body `{ credit: 'return' \| 'keep' }`, **required** (400 without it). `return` puts what the booking spent back to the package that paid (`credit_returned`); `keep` moves nothing (`forfeited`, a late cancel on the member's history); a booking that spent nothing is `n_a` either way. Never judged by the window or the cap, never counted toward the cap. Refused: `409 booking_attended`, `409 not_cancellable` (not confirmed), `400 workshop_cancel_unsupported`. `{ refund_outcome, refund_fired }`. Served with the instructor's by one role-parameterised module, `routes/portal/booking-cancel.ts` — see §3b. |
| POST | `/bookings/:id/no-show` | Mark `state='no_show'`, `check_in_state='no_show'`, fire forfeit logic |

### `finance.ts` (gated `requireRole('admin')`)

Every **Money Event** in a period, money in and money out, with the studio's five figures over it. Replaces the admin `payroll.ts` surface; the instructor's own Teaching log (`portal/instructor/payroll.ts`) is unchanged. See `docs/md/spec-finance.md`, `be/docs/adr/0002-finance-replaces-payroll.md` and `be/docs/adr/0003-finance-reads-as-a-general-ledger.md`.

Every event carries a **Type** and a **Variant** — what it was, and which one of it — alongside the `kind` that says which source table it came from and whether it may be edited. The two axes do not map one-to-one: a `purchase` splits into Credit, Unlimited, Trial and PT Package, while a Workshop ticket and the instructor paid to teach that workshop share one Type across two kinds. Type is set by the query that read the row, never inferred from the row's other fields. The member who paid and the instructor being paid collapse into one `user_name` — a ledger has one counterparty per line, and which side of the studio they stand on is what Type says.

Money **in** is unioned from `client_packages` (purchases, plus a separate row per Cross-Location Add-On), `bookings` where `kind = 'workshop'`, `stripe_payments` where `kind = 'corporate_package'`, `merch_orders`, and `stripe_payments` with `status = 'refunded'` (as negative Refund rows). Money **out** is `services/payroll`'s existing five-source union, unchanged — Finance does not re-derive what "a completed session that owes pay" means.

Merch is read from **`merch_orders`**, not from `stripe_payments` where `kind = 'merch'`. The order row is the purchase: it exists for a free item too — which never reaches the payment provider and so has no payment row at all — and it keeps its own frozen copy of the title and amount, so renaming, repricing or deleting a catalogue item never rewrites what the member bought. A Merch Order takes no Promo Code and has no Location, so its discount is always zero and it reports as Unattributed. Merch refunds need no special handling: `unwindRefund` finds neither a package nor a booking behind the intent, stamps the payment `refunded`, and the generic refund query picks it up.

Corporate rows are read at `status IN ('succeeded', 'refunded')`, **not** `succeeded` alone. The refund webhook flips the status, so filtering to succeeded would drop the sale out of Gross while leaving its negative Refund row standing — Net wrong by twice the amount. Every other money-in source reads its own table and is immune; corporate is the only kind that reads the payment row itself.

Discount is **derived** as List Price minus amount paid, never read from `promo_code_redemptions.discount_sgd`: that row is absent on a comp grant and tells only part of the story when a Promotion and a Promo Code stack.

Dates are **accrual** — a purchase on its payment date, a Refund on its refund date, Instructor Pay on the session's date. There is no payout-run record and no cash-basis view.

Location attributes cleanly on the cost side (every class, PT session and workshop has one) and almost never on the money-in side (`client_packages.location_id` is the Home Location of an Unlimited Plan and null for everything else). Those rows report as **Unattributed**, which is a filter value rather than a null hole.

Only Instructor Pay and Manual Entries are writable. There is deliberately no endpoint that edits a purchase or a Refund.

| Method | Path | Effect |
|---|---|---|
| GET | `/finance` | Every Money Event, newest first. Optional filters: `?type` (one Type), `?q` (substring of the member's or instructor's name), `?location` (a Location id or the literal `unattributed`), `?needs_pay=true`, `?from`, `?to`, plus `?instructor_id` and `?class_type_id`, which the portal no longer sends but the route still honours. An instructor or class-type filter is a question about teaching, so it excludes every money-in row. Response: `{ rows, totals, instructor_totals, unpriced_count }` where `totals` is `{ gross_sgd, discounts_sgd, refunds_sgd, instructor_pay_sgd, net_sgd }` over the WHOLE filtered range. |
| GET | `/finance/overview` | The period's headline figures. Takes `?from` and `?to` and **nothing else** — an overview narrowed to one instructor is not an overview, and a figure that moved because of a filter the reader has scrolled past reads as a fact. Response: `{ totals, unpriced_count, sales_by_category, by_instructor, members, classes }`. `sales_by_category` regroups the same rows `/finance` returns (Classes / PT / Workshops / Corporate / Merch) so its gross sums to the Gross tile; `members` is `{ active, joined }` where `joined` is period-scoped and `active` is a stock read **today**, ignoring the range (`client_packages.active` has no history to date it back with — see ADR 0003); `classes` is attendance per class type with the same count over the equally-long, half-open window immediately before (`null` when the period is unbounded). |
| GET | `/finance/export` | The same read, same filters, as `text/csv`, with the columns in the order the screen shows them: date, time, user, type, variant, price, location, discount, promo code, money in, money out, refunded. Date and time are split and rendered in studio time so a spreadsheet can sort and group them. A projection of the rows above — not a second query. |
| POST | `/finance/manual` | Create a Manual Entry. `{ instructor_id, amount_sgd, label, entry_date? }`. |
| DELETE | `/finance/manual/:id` | Remove a stray Manual Entry. |
| PATCH | `/finance/pay/:kind/:id` | `kind ∈ {class, pt, workshop, manual}`. Body `{ instructor_pay_sgd: number\|null, instructor_id? }` — sets or (with `null`) clears one instructor's pay on that session. `instructor_id` is required for workshops and needed wherever a session has supporting instructors. |

**Instructor Pay is optional** when scheduling (`be/docs/adr/0008-instructor-pay-is-optional-when-scheduling.md`). The admin create routes — `POST /schedule/classes`, `POST /schedule/series` (main and each supporting instructor), `POST /pt-requests/:id/schedule`, `POST /workshops` (main and each supporting instructor) — take pay as optional and nullable, and a roster arrival with no pay is stored `null` by `services/schedule/roster.replaceRoster`. Blank is **Unpriced**, never S$0; an explicit `0` is a price. The instructor equivalents never take pay at all — an instructor must never see pay rates.

Unpriced sessions are therefore ordinary. They are priced through Finance's `?needs_pay=true` filter, and Net says so while any remain.

### `check-in.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/check-in` | Today's (studio timezone) active classes and PT sessions, plus tomorrow's first ones once their Check-in Window has opened, each with `check_in_opens_at` and its roster (`booking_id, client_id, name, code, state, check_in_state, method, checked_in_at`; cancelled bookings left out). Optional `?location_id=` |
| POST | `/check-in/scan` | Exactly one of `{ qr_token }` or `{ code }` (case-insensitive). The code alone names the booking — no `session_id`. Inserts the `check_ins` row with `method` `qr`/`code` and sets `check_in_state='attended'`. Idempotent: an already-attended booking answers `outcome: 'already_checked_in'` and writes nothing. Refusals: 404 `booking_not_found` (unknown, or another studio's), 409 `booking_cancelled` / `session_cancelled`, 422 `check_in_not_open` (before the Check-in Window, or another day) / `check_in_closed` (the session's day has passed), 403 `not_your_session` (instructor) |
| POST | `/check-in/manual` | `{ booking_id, attended }` — manual tick and undo. Opens with the Check-in Window (`global_policy.check_in_opens_minutes_before`), never closes. A no-show (`/bookings/:id/no-show`) still waits for the start time |

### `inbox.ts` (workspace-scoped)

Per `admin-restructure.md` §13, the Inbox is now a **read-only notification feed**. PT request triage moved to its dedicated page (`pt-requests.ts` above). Inbox items are filtered to the active workspace location — admins see notifications for cancellations on that location's sessions.

| Method | Path | Effect |
|---|---|---|
| GET | `/inbox` | List with `?type`, `?read`. Default sort created_at desc. Workspace-filtered. |
| GET | `/inbox/unread-count` | For badge. Workspace-filtered. |
| POST | `/inbox/:id/mark-read` | Set `read_at`, `read_by_staff_id` |

### `clients.ts`

Every endpoint below requires `requireRole('admin')`, reads and writes alike — there is no read-only admin mode on Clients.

| Method | Path | Role | Effect |
|---|---|---|---|
| GET | `/clients` | admin | **Paged** directory for the portal's Customers page (`/admin/customers`). Query: `q` (name, email or phone, case-insensitive substring), `filter` (`active` \| `trials` \| `blocked`; absent = all), `include_deleted=true` (show blocked members under "all"), `status` (`active` \| `suspended`), `sort` (`joined` = newest first, default \| `name`), `page` (1-based, default 1), `page_size` (1–200, default 50; over 200 is 400). Search, filter and sort run in Postgres across every member, never over the page. Returns `{ clients, total, page, page_size, funnel }` — `total` counts every match across pages. Each row carries the trial funnel facts — `trial_started_at` (first trial purchase, `null` = never bought one), `attended` (classes turned up to on the trial) and `converted` (paid for anything that isn't another trial, comps excluded) — read for the page's rows only. `funnel` is `{ trials, attended, converted }` over every member the `trials` filter matches, and `null` under any other filter. `services/clients/manage.ts:listClientsPage`. |
| POST | `/clients` | admin | **Add customer.** Body `{ name, email, phone, gender?, send_invite? }` — `gender` one of `female` \| `male` \| `non_binary` \| `prefer_not_to_say`; `send_invite` defaults to `true`. Writes the `client` pool's auth user (no password) and the `clients` row together, then mails the `client_invite` unless `send_invite` is `false`. 409 `email_in_use` for an address already a member here. `201` with the member row. `services/clients/manage.ts:createClient`. |
| GET | `/clients/:id` | admin | Everything the customer detail page shows, in one read. The member row (`id, name, email, phone, status, joined_at, suspended_at, deleted_at, deleted_by_staff_id`) plus `gender`, `dob`, `waiver_signed_at`, `referred_by: { id, name } \| null`. **`packages`** — current packages (running, then Dormant, soonest-ending first) and **`past_packages`** — expired, used up or ended, newest first; both from `listClientPackages` split by `splitWallet`, same shape, each carrying `standing` (`running` \| `dormant` \| `expired` \| `used_up` \| `ended`, `validity.ts:packageStanding`) and `paid_online` (a Purchase stands behind it — false on a comp, a $0 trial, and every package a migration imports with `purchase_id` null). **`upcoming_bookings`** (still confirmed, from now, soonest first) and **`past_bookings`** (held: started before now and not cancelled — attended, no-show or never ticked — newest first, capped at 50) — classes, PT and workshops in one shape: `{ booking_id, kind, title, tier_name, session_type, starts_at, ends_at, location, instructor, state, check_in_state, refund_outcome, credits_used, package_name, code, booked_at, cancelled_at, cancel_preview }` (`services/bookings/member-history.ts`; `cancel_preview` as on the class roster, null where no cancel is offered). **`cancelled_bookings`** (#352) — every cancelled class (trial included), private session and workshop, whatever its start time, from the moment it is cancelled, newest cancellation first, capped at 50; corporate stays on the corporate requests page. The same shape plus `pt_request_id` and the shared cancellation summary (`services/bookings/cancellation-summary.ts`, the one the member's Cancelled tab reads): `cancelled_at`, `cancelled_by` (`member` \| `staff` \| `automatic` — a Void, a Remove, a Package rule change, a request's expiry \| `studio` — a cancel recorded before #350, naming nobody), `cancelled_by_name` (the staff member, when `staff`), `late`, and `outcome` (`credit_returned` — a private session's session counts as its credit \| `credit_kept_late` \| `credit_kept_over_cap` \| `credit_kept` \| `refunded` — a workshop's money \| `nothing_to_return`), and the two lines the portal shows as sent: `who_line` (`Member`, the staff member's name, `Automatic` or `Studio`) and `outcome_line` — the member's own outcome line but for whose cap and card it is (`Cancelled over their cap · credit not returned`, `Refunded to their card`). A private-session request withdrawn or expired while pending never had a booking: it is listed with `booking_id` and `code` null and `pt_request_id` set; who is its recorded `cancel_source`, so one a Complimentary Package's Remove cancelled is `automatic`, not the admin who removed it. A workshop place has no `cancellations` row: one cancelled with its Workshop names the staff member who cancelled the Workshop, one cancelled by a Refund's unwind is `automatic`. **`attendance`** `{ attended, no_shows, late_cancels, last_attended_at }` over every booking ever; `late_cancels` counts class cancels with `refund_outcome` `forfeited` only — a private session's kept session is not a Late cancel. **`payments`** — payments through the provider, newest 50: `{ id, item_name, kind, amount_sgd, status, purchase_status, receipt_url, refunded_at, created_at }` (`services/billing/member-payments.ts`). Plus `adjustments`, `workshop_purchases` and `open_purchases` as before. 404 `client_not_found` for another studio's member, checked before anything else is read. Admin views are workspace-agnostic — Clients is global. |
| DELETE | `/clients/:id` | admin | **Block** — sets `deleted_at` and ends the member's sessions at this studio; the client pool refuses their next sign-in here (`client_blocked`). Nothing is erased; bookings/packages/ledger are preserved. Logs `user_blocked`. |
| POST | `/clients/:id/restore` | admin | **Unblock** — clears `deleted_at`, which is all it takes to sign in again. Logs `user_unblocked`. |
| GET | `/clients/:id/sessions` | admin | The member's live sessions **at this studio** (#119): `{ sessions: [{ id, signed_in_at, last_seen_at, expires_at, ip, user_agent, impersonated }] }`, newest first. `last_seen_at` moves when the session is refreshed, about once a day. 404 `client_not_found` for another studio's member. |
| POST | `/clients/:id/sessions/revoke` | admin | **Sign out everywhere** — ends every session the member holds at this studio, on every device; their next request is 401. Another studio's sessions for the same person are left alone. `{ revoked: n }`. Logs `sessions_revoked`. |
| POST | `/clients/:id/send-set-password` | admin | **Send set-password link** (#173) — mails the member the same single-use link their own sign-in sends, landing on this studio's member app. `{ sent: true }`. 409 `client_blocked`; 429 `too_many_requests`. Logs `invitation_resent`. |
| GET | `/clients/:id/export` | admin | **Download data** (#143) — everything this studio holds about the member, for an access request: a zip in the studio archive's format, `manifest.json` (`kind: 'member'`, the member, per-table counts) plus `tables/<name>.json`. The tables and the columns that name a member are `MEMBER_TABLES` (`services/clients/member-tables.ts`), the list member deletion also reads; a guard test fails on a schema column that names a member and is not in it. Includes a blocked member. Logs `member_data_exported`. 404 `client_not_found` for another studio's member. |
| DELETE | `/clients/:id/permanently` | admin | **Delete permanently** (#144) — on the member's request; blocking stays the reversible option. Every row `MEMBER_TABLES` finds for them is deleted, except the studio's accounts (payments and refunds, package sales, Promo Code uses, merch sales), which stay with the member's identity removed, and the audit rows that named them, which stay anonymised (`docs/adr/0008-audit-rows-are-archived-not-deleted.md`); each table's `erase` steps say which. Ends their sessions at this studio. Their sign-in account is deleted only when no other studio still has a member row for it, and the response does not say which happened. `{ deleted: true }`. Logs `member_deleted` with **no subject**; the audit row records the route pattern, not the id. A second delete, or another studio's member, is 404 `client_not_found`. What is kept, why, and for how long: [`member-data-retention.md`](member-data-retention.md). |

There is no separate suspend/unsuspend surface — blocking is the single mechanism. `requireActiveClient` rejects a blocked client on `deleted_at` as well as `status`.

Block, unblock and sign-out are **per studio**: a login is one studio's own (ADR 0006), and the same person at another studio has another login, which these never touch. Each act writes an `auth_events` row filed under `staff`, with the acting staff member's auth user as actor and the member's client auth user as subject.
| GET | `/clients/:id/packages/:client_package_id/credit-history` | admin | The package's **Credit history** (#353), the profile's per-package history (admin-restructure §15d): the member's `GET /me/packages/:id/credit-history` shape, each movement adding `staff_name` and `note` (a staff adjustment's reason). A package not this member's, or not this studio's, is 404 `client_package_not_found`. Every edit below writes its Credit movement beside its `manual_adjustments` row. |
| POST | `/clients/:id/credits/adjust` | admin | `{ client_package_id, delta, reason }` — manual credit adjust. Valid for `kind in ('credit_bundle', 'unlimited', 'trial')`. See §3d. |
| POST | `/clients/:id/sessions/adjust` | admin | Same shape, for PT session balance (`kind='pt'`) |
| POST | `/clients/:id/packages/:client_package_id/expiry` | admin | `{ expires_at, reason }` — edit expiry on `client_packages` (per `admin-restructure.md` §16 "Edit expiry" action, applies to `credit_bundle`, `unlimited`, `trial`). A **null `expires_at` returns the plan to Dormant** (spec-pre-launch-batch.md §8) — the escape hatch the one-way activation rule depends on — and is accepted for **every kind** (ADR 0004 — every package starts Dormant). Giving a Dormant package a date is an Activation by hand, accepted while other packages of the same Family are running — both then run (be/docs/adr/0010; `family_already_activated` is retired). Writes a `manual_adjustments` row with `delta=0` and the reason note, which renders a null expiry as "Dormant". |
| POST | `/clients/:id/packages/:client_package_id/cross-location` | admin | `{ paid_sgd: number \| null, reason }` — attach (amount) or remove (`null`) the **Cross-Location Add-On** on one Unlimited Plan (spec-pre-launch-batch.md §5). 400 `cross_location_requires_unlimited` for every other kind. Writes a `manual_adjustments` row with `delta=0` and the reason, exactly as the expiry edit does. |
| POST | `/clients/:id/packages/:client_package_id/location` | admin | `{ location_id, reason }` — move a member's **Home Location** (spec-pre-launch-batch.md §7), the correction for a studio picked wrong at checkout. Moves the member's Activated plan **and** any Dormant renewal in one transaction, so the two can never disagree and re-open the two-Activated-plans hole §6 closes. **Bookings are untouched**, including bookings at the Location being left. 400 `home_location_requires_unlimited` for every other kind, 400 `home_location_unchanged`, 400 `home_location_plan_not_live` on a plan that has already ended, 404 `location_not_found`, 400 `location_archived`. Writes one `manual_adjustments` row per plan moved, `delta=0`, naming both Locations and the reason. |
| POST | `/clients/:id/packages/:client_package_id/bound-instructor` | admin | `{ instructor_id: uuid \| null, reason }` — bind a purchased PT Package to an instructor, move it to another, or clear it back to open (`null`) (#110, spec #107 §33-§37). 400 `bound_instructor_requires_pt` for every other kind, 400 `instructor_not_active` for a staff id that is not an active instructor of the Tenant, 400 `bound_instructor_unchanged` for a no-op. **Sessions already scheduled are untouched** — the binding decides who may pick up future requests. Writes a `manual_adjustments` row with `delta=0` naming the before and after instructors and the reason, exactly as the expiry edit does. The instructor being moved *away* from is named even when archived, and is not required to be active: a package bound to a leaver stays bound until an admin rebinds it. |
| POST | `/clients/:id/packages/issue` | admin | `{ package_kind: 'class' \| 'pt', package_id, reason, location_id?, cross_location?, instructor_id? }` — give a **Complimentary Package** (#176). Goes through the same grant a purchase does, so it lands Dormant with its validity and List Price frozen, obeys the Family and one-trial rules, and takes a Home Location (and optionally the Cross-Location Add-On, also at $0) for an Unlimited Plan and a Bound Instructor for an Instructor-Bound PT package. Writes `amount_paid_sgd=0`, `purchase_id=NULL` (a grant no sale paid for, so there is nothing on it for a Refund to return) and `complimentary=true`, which is what keeps its List Price out of **Gross** and the member out of **Converted**. The reason is required and lands on the member's `manual_adjustments` ledger (`delta=0`) and in `audit_log` as `complimentary_package_given`. **No email.** 409 `trial_already_used`, 409 `client_blocked`, 400 `unlimited_requires_location`, 400 `pt_bound_requires_instructor`. `201 { client_package_id }`. |
| POST | `/clients/:id/packages/:client_package_id/remove` | admin | `{ reason }` — **Remove** a Complimentary Package given by mistake (#176). No money moved, so this is not a Refund: it cancels every class or session it paid for that has not been held, clears those bookings' link to it, and deletes the package row; the reason is written to `audit_log` as `complimentary_package_removed`. Allowed only while the package is **Untouched** — 409 `package_touched` once a class it paid for was attended, no-showed or has already started, 409 `package_has_live_bookings` when a booking on it would not cancel, 400 `not_complimentary` on a purchase. `{ removed: true, cancelled_bookings: n }`. |
| POST | `/clients/:id/email` | admin | `{ email }` — change the member's email (#176). Trimmed and lower-cased; updates `clients.email` and replaces this studio's login for the member: `clients.auth_user_id` is re-linked to a login for the new address at this studio (through `ensureAuthUser`), and the old login is deleted with its password and sessions, in one transaction (ADR 0006). The new login has no password, so the member's first sign-in there mails them the set-password link (#173). The same person's login at another studio is untouched. 409 `email_in_use` when another member of this studio uses it, 400 `email_unchanged`. Audited as `client_email_changed` with the old and new address, and `sessions_revoked` in `auth_events`. **No email is sent by the change itself.** |
| PATCH | `/clients/:id/profile` | admin | `{ name?, phone?, gender? }`, at least one — edit the member's profile (#281, `services/clients/edit-profile.ts`). Name 1–160 and phone 1–40, both trimmed, as at create and registration; phone is free text. `gender` is `female` / `male` / `non_binary` / `prefer_not_to_say`, or null to clear it. 400 `name_required` / `phone_required` for a blank value and 400 `invalid_request` otherwise, each with a `message`; 409 `client_blocked` for a blocked member; 404 `client_not_found` for another studio's. Audited as `client_profile_edited` with `{ from, to }` holding only the fields that changed; a save that changes nothing writes no such entry. Returns the client row, with `gender`. |

### `staff.ts` (admin)
| Method | Path | Effect |
|---|---|---|
| GET | `/staff` | List staff_users + open invitations. Each row carries `role` (`admin \| instructor`); there is no seeded or main admin, so rows carry no seeded flag and no `granted_location_ids`. Each row also carries `pending_email` — `{ email, sent_at, expires_at, expired }` for an Unverified address awaiting its confirmation link, else null — as do the rows `PATCH /staff/:id`, `/archive` and `/unarchive` return. Each row also carries `permissions` — the instructor's granted **Instructor Permissions** (`string[]`, `be/docs/adr/0011`), `null` on an admin, whom they never gate — as do the rows the writes return. |
| POST | `/staff/invite` | `{ email, role?: 'admin' \| 'instructor', permissions?: string[] }`, role default `admin`. `permissions` is the instructor's grant from their first sign-in, written onto the instructors row the invitation makes; omitted means all three. Stated on an admin invitation it is 400 `permissions_require_instructor` and nothing is invited. No location grants are set. See §3a. |
| POST | `/staff/invitations/:id/revoke` | Set `status='revoked'`. Re-invite requires fresh row. |
| PATCH | `/staff/:id` | Edit a staff profile (name, contact, bio, languages, Assigned Days and this Leave Year's Remaining — for any staff member, admins included, #315) and `role`. Rank is admin > instructor: editing someone who outranks you is 403 `outranked_staff_edit_forbidden`, and a patch carrying `role` from a non-admin is 403 `privilege_fields_admin_only`. Changing your own role is refused. **Last-admin guard:** changing the role of the studio's only active admin (role `admin`, status `active`, not soft-deleted) away from `admin` is 409 `cannot_demote_last_admin`; the count and the write run in one transaction. **Instructor Permissions:** an optional `permissions` array of the three keys, the whole grant, replacing what is stored; a duplicate key fails validation (400). On a staff member whose role is `admin` once the patch's own role change is applied — an admin, or an instructor being promoted in the same request — it is 400 `permissions_require_instructor` and nothing is written. A role change to `instructor` makes the instructors row with the default, all three; a change to `admin` leaves the row and its permissions in place, so a demotion later restores them. |
| POST | `/staff/:id/email` | Start a sign-in email change for anyone the admin may edit, themselves included: `{ email }` → saves the address as Unverified and mails a confirmation link (`{studio portal}/confirm-email?token=…`, 24 hours) to it; answers `{ pending_email: { email, sent_at, expires_at, expired }, resend_after_seconds }`. Nothing on the account changes yet. The same address again is the resend; a new link, for any address, replaces the old. 409 `email_in_use` (another staff member's login at this studio), 400 `email_unchanged`, 400 `email_placeholder_not_allowed` (`.invalid`), 409 `staff_archived`, 429 `too_many_requests` inside 30 s of the last link, 503 `email_send_failed` (nothing is saved). |
| DELETE | `/staff/:id/email` | Revoke the Unverified address: its link stops working and `pending_email` goes null. The 30-second resend wait still holds. 204. |
| POST | `/staff/:id/archive` | **Block** a staff member: status `archived`, and their sessions at this studio end. Archiving yourself is refused. **Last-admin guard:** archiving the studio's only active admin is 409 `cannot_archive_last_admin`, counted and written in one transaction. Logs `user_blocked`; `/staff/:id/unarchive` logs `user_unblocked`. |
| DELETE | `/staff/:id` | Soft-delete. Requires the row to be archived first (400 `staff_not_archived`), so the last-admin guard on archive already covers it — no separate check. |
| GET | `/staff/:id/sessions` | The staff member's live sessions at this studio, same shape as `/clients/:id/sessions` (`impersonated` always false). 404 `staff_not_found` for another studio's staff. |
| POST | `/staff/:id/sessions/revoke` | **Sign out everywhere** at this studio; their next request is 401. Any admin may sign out any staff member, including another admin or themselves; the last-admin guard does not apply (the admin can sign in again). `{ revoked: n }`. Logs `sessions_revoked`. |
| POST | `/staff/:id/resend-invitation` | Re-mails the set-password link: the pending invitation when there is one (as `/staff/invitations/:id/resend`), otherwise Better Auth's reset link on the studio's portal, which sets a first password as readily as it replaces one. `{ sent: 'invitation' \| 'set_password' }`. 409 `staff_archived`. Logs `invitation_resent`, as does `/staff/invitations/:id/resend`. |

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
| GET | `/feature-flags` | List rows. A key with no row is off. Known keys: `waitlist_enabled` (class waitlists, spec-waitlist §8 — members can join a full class's line; off, joins are refused and existing lines still promote and can be worked). The portal's Features screen lists every known key with a one-line description. |
| PATCH | `/feature-flags/:key` | `{ enabled: bool }`. Updates DB + invalidates `lib/feature-flags-cache.ts` (process-local). Multi-instance deployments require pub/sub trigger — deferred. |

---

## 3. Portal-driven business flows

### 3a. Staff invitation flow

Triggered from: `POST /staff/invite` (admin) or auto-fired during `POST /instructors`.

Invitation-only in fact (#115): there is no staff sign-up, and nothing links a stranger's account to a row by address.

```
services/auth/invitations.ts:inviteAdmin / catalog/instructors.ts:createInstructor
  ↓  one transaction (writePendingStaff)
1. Find or create the `staff` pool auth user for the address (no password)
2. Insert staff_users row: { email, role, status='pending', auth_user_id }
3. Insert staff_invitations row: { email, role, token, expires_at = now + 7d, status='pending', invited_by_staff_id, staff_user_id }
  ↓  after commit
4. Mail 'admin_invite' | 'instructor_invite' with invite_url = {studio portal}/signup?invite_email=…&invite_token=… (redacted in email_log)
```

When the invitee opens the link (`fe-portal` `/signup`, on the inviting studio's hostname):
- `GET /public/staff-invitation?token=` → status, email, role, `password_set`.
- `POST /public/staff-invitation/accept { token, password, first_name, last_name }` sets the first password (only if the account has none — a token never replaces one), sets `staff_users.status='active'`, and marks the invitation accepted. The page then signs in with that password.
- Resend (`/staff/invitations/:id/resend`) re-mails the same link with a fresh 7-day expiry. Revoke before acceptance deletes the pending staff row (and with it the invitation) and the auth user if it never had a password.
- Archiving a staff member deletes their Better Auth sessions **at that studio** (`endStaffSessionsAt`); their login at any other studio they work at is another account (ADR 0006), and stays signed in.
- **A staff email change is confirmed here too** (`fe-portal` `/confirm-email`, on the studio's hostname, from the link `POST /staff/:id/email` mailed). `GET /public/staff-email-change?token=` → `{ status: 'valid'|'expired'|'invalid', email }`. `POST /public/staff-email-change/confirm { token }` → `{ email }`: moves `staff_users.email` and the same `staff` pool login (password, second factor and sessions kept), and a pending invitation's address, with a new invitation token. Mails a notice to the old address unless it is a placeholder. 400 `email_change_link_expired`, 400 `email_change_link_invalid` (used, replaced, revoked or never issued — or the admin who sent it has since been blocked, deleted or made an instructor, since nobody signs in to confirm), 409 `email_in_use`, 409 `staff_archived`. Audit `staff_email_changed` `{ from, to }`, with the admin who sent the link as actor.
- **A password reset accepts a pending invitation.** A reset on a studio's portal (`POST /api/v1/auth/staff/reset-password`) where the person is still `pending` with an unexpired invitation marks it accepted and the row `active` (`acceptInvitationOnPasswordReset`) — the reset link proved the same inbox. An expired or revoked invitation is not overturned.

The portal's sign-in form asks for the email first, as the super portal's does:
- `POST /public/staff/sign-in-step { email }` → `{ next: 'password' }` when the address has a staff password **at this studio** and has no live invitation here; else `{ next: 'link_sent' }`. For `link_sent` a set-password link (Better Auth's reset, landing on this portal's `/login`) is mailed if the address is active staff here with no password, or pending here with an unexpired invitation, and nothing otherwise — the answer is the same. Logins are per studio (ADR 0006): a password at another studio is that studio's and is never asked for here, so the pending case is what lets someone already staff elsewhere in as this studio's first admin. The step is budgeted per address, and per email at each studio (429 `too_many_requests`); links are budgeted per email at each studio too, and a spent link budget still answers `link_sent`, so no refusal marks an address as staff.

A studio's *first* admin, invited from the super portal (at provisioning, or later through `POST /api/v1/platform/tenants/:id/admin`), goes through this same flow: `writePendingStaff` writes the auth user, the pending row and the invitation inside the provisioning transaction, with `invited_by_staff_id` null — nobody on the studio's staff did the inviting — and the mail, signed by the studio, goes after the commit. A mail that fails is logged and the invitation can be resent from the staff list.

### 3b. Cancellation paths — staff vs. client

Both paths pass through `services/bookings/cancel.ts`. The branch is on the `source` parameter: `client`, or a staff cancel of one booking (#320) — `admin` on any booking, `instructor` on a class the caller may work (`assertMayWorkClass`, the waitlist's rule; `403 not_your_session` otherwise, and on any non-class booking).

| Step | Client path (`source='client'`) | Staff path (`source='admin'` \| `'instructor'`) |
|---|---|---|
| 1. Policy evaluation | Calls `services/policy/evaluate-cancellation.ts` — produces `{ refund: 'full' \| 'forfeit', reason }` based on cap + window | **Bypassed** — the staff member's `credit` choice decides |
| 2. Refund decision | `refund='full'` → return credit (class) or session (PT) to `client_packages.credits_or_sessions_remaining`. `refund='forfeit'` → no return; booking still marked cancelled. | `credit='return'` → return credit/session (ledger reason `{source}_cancellation_refund`). `credit='keep'` → no ledger movement, `forfeited`. Nothing spent (Unlimited, Voided) → `n_a` either way (`settleCancel`). |
| 3. Booking update | `state='cancelled'`, `refund_outcome` set per outcome | Same |
| 4. Cancellation row | Insert `cancellations` row with `source='client'`, `was_within_window`, `was_within_cap`, `refund_fired` | Insert `cancellations` row with `source='admin'` or `'instructor'` (excluded from cap calc), `was_within_window` recorded truthfully against the class's effective window, `was_within_cap=true` |
| 5. Inbox | Insert `inbox_items` of `type='client_cancellation'` | Insert `inbox_items` of `type='admin_cancel_class_pt'`, payload carrying `source` and `actorStaffId` |
| 6. Email | After commit: `class_cancelled_credit_returned` / `pt_cancelled_session_returned` to the member when the refund fired (NTF-09). The forfeited pair is not sent yet. | None for a staff cancel of one booking (#320). A whole-session cancel sends, after commit, to every member booked: `admin_cancel_class` (`/schedule/classes/:id/cancel`, admin or main instructor, with the credits returned), `admin_cancel_pt` (a staff cancel of a manual session, with the session returned), `admin_cancel_workshop` (with the amount paid); a member's PT Request cancelled by staff sends `pt_request_cancelled` (NTF-10, NTF-11; §3c.cancel) |

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
tx commit
5. 'admin_cancel_workshop' email to each attendee, after commit and best-effort (NTF-10):
   { client_name, workshop_name, amount_paid, workshops_url } — amount_paid in the shared money
   form (sgdText, "S$120.00"). As built, nothing is refunded automatically (#272: bookings are
   marked refund_outcome='n_a' and each refund is the admin's, from the member's page), so the
   email states what they paid and that the refund is being arranged.
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
   → else 409 partner_account_required (admin must create the partner via /admin/customers first)
2b. Bound Instructor check: services/pt-sessions/binding.ts:maySchedulePtRequest, against the
   debited client_packages row's bound_instructor_id. Admin → always allowed. Unbound package
   → allowed for anyone. Instructor on a package bound to them → allowed.
   → else 403 pt_request_bound_to_other_instructor
   The admin route passes actor_is_admin=true and the service does NOT force the bound
   instructor onto the session — the dialog pre-selects them and the admin may override for
   that one session. The instructor route forces instructor_id = self, so the rule refuses
   a bound-to-other request there.
3. Conflict check: no class, workshop_day, pt_session or corporate_session the instructor is
   ON — main or supporting — overlaps [starts_at, ends_at]
   → if conflict: 409 schedule_conflict
4. Room check: services/schedule/room-conflicts.ts (assertRoomInLocation + assertRoomAvailable)
5. Location check: location_id is an active location of this studio (no per-staff grants)
6. Insert pt_sessions row: pt_request_id=X, instructor_id, location_id, room_id, starts_at, ends_at,
   session_type (copied from request), capacity_online (default 1 for 1on1, 2 for 2on1),
   lifecycle='active', scheduled_at=now(), scheduled_by_staff_id=actor_staff_id
7. Insert pt_session_clients rows: requesting client + co_client (if 2on1)
8. Insert bookings row(s): kind='pt', pt_session_id=new id, state='confirmed',
   credits_or_sessions_used=1 per client (recorded on the booking for audit; the debit
   itself already happened on submit and is not re-applied here); generate qr_token + code
8b. Activation (be/docs/adr/0011): SELECT the debited client_packages row FOR UPDATE; if it is
   Dormant (the request left it so), stamp expires_at = now() + validity_days and
   activated_by_pt_session_id = new id. A package already running is left alone.
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
    3. (email after commit — see below)

  WHEN 'scheduled':
    1. Update pt_requests SET status='cancelled_after_scheduled', resolved_at=now()
    2. Update pt_sessions SET lifecycle='cancelled', cancelled_at=now(),
                              cancelled_by_staff_id=actor (NULL for client/system)
    3. UPDATE every booking on the session: state='cancelled', refund_outcome='forfeited',
       cancelled_at=now()
    4. INSERT cancellations rows (kind='pt', source=client|admin|instructor|system,
       cancelled_by_staff_id=actor for admin|instructor (NULL otherwise),
       was_within_window, was_within_cap, refund_fired)
    5. INSERT inbox_items row (type='admin_cancel_class_pt') for the admin queue.

  WHEN other (already terminal):
    no-op (idempotent)
END

tx commit
emails (after commit, best-effort; a failed send is logged and the cancel stands)
```

**The emails** (#359; gathered in the transaction, sent once it commits, so a refused or rolled-back cancel mails nobody):

- A member's request (NTF-11), cancelled by the member, an admin or the instructor: `pt_request_cancelled` to the requester and, after scheduling, to a 2-on-1 partner whose seat went with it — one email for both branches (admin-restructure §9e). `session_line` names a scheduled session by instructor and time and a pending one as "Your private session request"; `refund_line` ("2 sessions have been returned to your package.") is there only when sessions came back, so the partner, who paid nothing, gets none. An expiry or a Remove (`source='system'`) sends nothing.
- A manual session cancelled by staff (NTF-10): `admin_cancel_pt` to every member seated, with the session returned to each. A member leaving their own seat in time: `pt_cancelled_session_returned`.

A **manual session** (`pt_requests.origin = 'portal'`, #335) has no debit on its request, so its scheduled branch is `services/pt-sessions/manual.ts:cancelManualSessionInTx`, settled per booking: a staff cancel (admin, or the session's instructor) cancels every seat, each refunded to its own package; a member — the request's client or co-client — cancels **only their own seat**, refused inside the PT window (`422 cancellation_window_passed`) and refunded by the shared cap outside it, and the session goes on for whoever is left (`status: 'seat_cancelled'`) or is cancelled with its last attendee (`cancelled_after_scheduled`). Either way, a package the session Activated returns to Dormant unless the cancel was late (be/docs/adr/0011).

**Who cancelled** (#350). The `cancellations` row names its source truthfully: `client` for the member, `admin` from the admin route, `instructor` from the instructor route (`/pt-requests/:id/cancel`, consistent with an instructor removing a member from a manual session), each staff source with `cancelled_by_staff_id`; and `system` for a cancel the studio's machinery makes — a Complimentary Package's Remove (`source='system'`, the admin still named on the request and the ledger) — naming no staff member. Every source but `client` settles as a staff cancel. Rows written before #350 carry no staff id and are read as the studio's.

**A PT booking cancelled on its own** (`services/bookings/cancel.ts`: a Refund's Void, a Remove, a single-booking staff or member cancel) settles its request and session too (`services/pt-sessions/manual.ts:settleSessionAfterBookingCancel`, #350). On a member's request the requester's booking pays for the whole session, so it going ends the request `cancelled_after_scheduled` and cancels the session and any partner seat (`n_a`); a partner's seat going leaves it on. On a manual session the request follows who is still booked, and the last seat going ends both — unless a staff member cancelled it, who frees the seat to fill again, as removing a member does. Either way the session is never left scheduled with nobody paying, nor completed as attended once its time passes.

Expiry path (`pt-request-expiry` cron): pending requests past `expires_at` go through the same `'pending'` branch above with `source='system'` and `actor=NULL`, ending up `cancelled_before_scheduled` + credits refunded. No email is sent yet (`pt_request_expired` has no sender).

**Activation reversal** (be/docs/adr/0011). A pending request's cancel or expiry refunds to a package that is still Dormant — nothing was Activated. In the `'scheduled'` branch, and in the single-booking cancel of the requester's paying seat, if the package's `activated_by_pt_session_id` is this session and the cancel is not late (not inside the PT cancellation window — only staff can cancel there), the package's `expires_at` and `activated_by_pt_session_id` are cleared in the same transaction and a zero-delta `manual_adjustments` row with reason `pt_activation_reversed` is written (actor = the staff member, or NULL for a member). The balance the cancel returned or kept is unaffected. A later session's cancel, a late cancel, a Voided package, and a package whose expiry staff have set by hand (which clears the pointer) never reverse.

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
   main_instructor_id ∉ supporting_instructor_ids → else 400 supporting_instructor_duplicates_main
   (enforced by the roster module at write time, in the transaction)
4. Conflict checks (reused corporate-session create logic) — both are 409 schedule_conflict:
   - room clash across classes / workshop_days / pt_sessions / corporate_sessions
   - instructor (main + supporting) overlap, across the same four kinds
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

Scoped to the authenticated instructor. `staffAuth` loads `staff_users` and resolves the caller's Instructor Permissions onto the Hono context (`staffPermissions`); the instructor's id is the staff user id.

**Gates.** Every route here is behind `requireRole('instructor', 'admin')`. The routes marked **`schedule_classes`** below are also behind `requirePermission('schedule_classes')` (§1 Workspace scoping & role gates; `be/docs/adr/0011`): an instructor without that Instructor Permission is refused `403 forbidden_permission { required: 'schedule_classes' }` before the body is read and before any ownership check, and a class they made while they had it stays on the timetable. Every route in `pt-requests.ts` is likewise behind `requirePermission('take_pt_bookings')`. The routes marked **`manage_rosters`** — member search, booking a member in, the three waitlist routes and the booking cancel — are behind `requirePermission('manage_rosters')`. The waitlist and booking-cancel routes come from factories shared with the admin mount (`class-waitlist.ts`, `booking-cancel.ts`), so that gate is registered where the instructor subtree mounts them, ahead of them, never inside the factory; the admin mounts are ungated by it. Nothing else here is gated by a permission: the timetable, the roster read, check-in, the catalogue pick lists, payroll and the profile are what an instructor needs to teach. An admin is never refused by a permission.

### `schedule.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/schedule` | All `classes` + confirmed `pt_sessions` + `workshops` where the instructor is assigned, with `event_state` computed |
| GET | `/schedule/today` | Same, filtered to today (SGT) |
| POST | `/schedule/classes` | **`schedule_classes`.** Create a class. The admin body without `main_instructor_id`, supporting instructors or `instructor_pay_sgd`: the caller is forced as main instructor, nobody supports, and pay is `null` (Unpriced). Those fields, if sent, are ignored. |
| POST | `/schedule/series/preview` | **`schedule_classes`.** **Class Series** preview — the admin contract (§2 `schedule.ts`) with the same forcing as a single class: the caller is the main instructor, no supporting instructors, pay `null`. Location and room come from the body. `main_instructor_id`, `instructor_pay_sgd` and `supporting_instructors`, if sent, are ignored. |
| POST | `/schedule/series` | **`schedule_classes`.** Commit the same body, all or nothing: `201 { series, class_ids }`, `409 series_conflict { dates }`. There is no instructor extend or end: those are admin only (`403` on the admin routes). |
| POST | `/schedule/classes/:id/cancel` | **`schedule_classes`.** Cancel a class the caller is the **main** instructor of, `{ reason }` required — the admin cancel (§3b) with `source='instructor'`, so every member is refunded the same way. `403 not_main_instructor` on anyone else's class (judged after the permission). An admin may still cancel the class from `/admin/schedule/classes/:id/cancel` whatever the instructor's permissions. |
| GET | `/schedule/classes/:id/packages?client_id=` | **`manage_rosters`.** The admin route's read of the member's class packages for the class (#333), on a class the caller is the **main** instructor of. Another instructor's class is `403 not_your_session`. |
| POST | `/schedule/classes/:id/bookings` | **`manage_rosters`.** Book a member onto a class the caller is the **main** instructor of — the admin route's booking, into a **buffer** seat only, `client_package_id` included (#333). `overbook` in the body is ignored: an instructor never overbooks, so a full buffer is `409 class_full`. Another instructor's class is `403 not_your_session`. |
| POST | `/schedule/classes/:id/waitlist` | **`manage_rosters`.** The admin route's staff join, on a class the caller is the main instructor of. `403 not_your_session` otherwise. |
| POST | `/schedule/classes/:id/waitlist/:entryId/promote` | **`manage_rosters`.** The admin route's **Add to class**, on the caller's own class: online seat, else buffer, else `409 class_full`. `overbook` in the body is ignored. |
| DELETE | `/schedule/classes/:id/waitlist/:entryId` | **`manage_rosters`.** The admin route's **Remove**, on the caller's own class; `resolved_by` = the instructor's staff id. |

### `roster.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/sessions/class/:id/roster` | A class the caller is the main instructor of: the admin class detail's seat fields, roster (`attendees[].seat`, `promoted_from_waitlist` and `cancel_preview` included), `cancelled_bookings[]` and waitlist (`waiting`, `waitlist_enabled`, `waitlist[]`), without pay, series or scheduling provenance. `403 not_your_session` otherwise. `services/schedule/detail.ts:getOwnClassDetail`. |
| GET | `/sessions/pt/:id/roster` | A private session the caller runs (#338): the admin's `/schedule/pt/:id` read — `origin`, `clients[]` with each seat's `package` — without pay or supporting instructors. `403 not_your_session` otherwise. `services/schedule/detail.ts:getOwnPtSessionDetail`. Ungated, like the class roster read: seeing who is coming is teaching, not a permission. |
| GET | `/clients?q=` | **`manage_rosters`.** Members of the studio matching `q` (name, email or phone; 1–100 chars), for Add member: `{ clients: [{ id, name, email }] }`, at most 10, blocked members left out. |

### `bookings.ts`
| Method | Path | Effect |
|---|---|---|
| POST | `/bookings/:id/cancel` | **`manage_rosters`.** The admin route's staff cancel (§2 `bookings.ts`, §3b), body `{ credit: 'return' \| 'keep' }` required, on a class the caller leads; `403 not_your_session` on anyone else's class and on a private session's booking (cancelled as a PT request instead). Recorded `source='instructor'`. |

### `catalog.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/catalog/class-types`, `/catalog/rooms` | The scheduling forms' pick lists, archived rows left out. |
| GET | `/catalog/features` | `{ waitlist_enabled }` — the studio switch, so the capacity fields can label the Waitlist input "(waitlists are off)" (spec-waitlist §8). |

### `check-in.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/check-in` | Same as admin, listing only the sessions the caller teaches |
| POST | `/check-in/scan` | Same as admin scan, but service-layer guard enforces ownership |
| POST | `/check-in/manual` | Same |

### `pt-requests.ts`
| Method | Path | Effect |
|---|---|---|
| POST | `/pt-requests/sessions/:id/members` | **`take_pt_bookings`.** Same as the admin add-member (#337), on a manual session the caller runs; another instructor's session is `403 not_your_session`, and a member bound to another instructor is `403 bound_to_other_instructor` whatever `override` says. |
| DELETE | `/pt-requests/sessions/:id/members/:clientId` | **`take_pt_bookings`.** Same as the admin remove-member (#335), on a manual session the caller runs; another instructor's session is `403 not_your_session`. The cancellation is recorded with `source = 'instructor'`. |
| GET | `/pt-requests/seat-candidates?client_id=&session_type=` | **`take_pt_bookings`.** Same as the admin read (#337) without `instructor_id`: read against a session the caller runs, so a package bound to another instructor is `eligible: false` with `reason: 'bound_to_other_instructor'`, not a warning. |
| GET | `/pt-requests` | **`take_pt_bookings`**, like every route in this file: the read is gated as well as the writes, since the queue names the member behind every unbound request. A PT session an admin schedules for an instructor without it is still on their timetable and check-in desk. Pending PT requests this instructor may act on (workspace-agnostic): those debited from an unbound package, plus those bound to them. A request bound to a different instructor is not theirs to pick up, so it is filtered out. Each row carries `bound_instructor` (`{ id, name }` or null) — on this surface a non-null value always means "bound to you". |
| POST | `/pt-requests/:id/schedule` | **`take_pt_bookings`.** Same shape as the admin route — `services/pt-sessions/schedule.ts:schedulePtRequest()`. The service forces `instructor_id = ctx.instructor_id` on this surface. |
| POST | `/pt-requests/:id/cancel` | **`take_pt_bookings`.** Same shape as admin cancel, optional `{ note? }` included — branches on current status per §3c.cancel. |
| POST | `/pt-requests/manual` | **`take_pt_bookings`.** Same as the admin manual session (#334) without `instructor_id`: the session's instructor is always the caller, and a member whose package is bound to another instructor is `403 bound_to_other_instructor` whatever `override` says — never a warning. |

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
- **Cancellation evaluation algorithm** — spine §6 (`services/policy/evaluate-cancellation.ts`); the portal staff path bypasses it (see §3b).
- **Stripe webhook handlers + receipt URL population** — spine §4 (External integrations).
- **SMTP transport** — spine §4.
- **Background job schedulers** (`sendCheckInNags`, `credit-expiry`) — spine §5. The check-in nag mails a session's Instructor and copies every active Admin once its check-in has been pending 24 hours past its end; each link opens the recipient's own check-in desk.
- **Migrations + seed** — spine §7.

---

## 6. Open portal-side questions

1. **Multi-instance feature-flag invalidation.** v1 toggles update the local cache only. If we deploy >1 HTTP instance behind a load balancer, toggles will be inconsistent for up to one boot cycle per instance. Acceptable for v1 (single-instance) — revisit when scaling out.
2. **Workshop refund failure recovery.** v1 inline-retry-3x is best-effort. A manual reconciliation report listing `bookings WHERE refund_outcome='stripe_refunded' AND no corresponding stripe_payments.refunded_at within 24h` is a useful add — deferred to phase 2 reports module.
3. **Audit-log surfacing UI.** Spine writes to `audit_log`; admin read views are deferred (`admin-restructure.md` §19).
