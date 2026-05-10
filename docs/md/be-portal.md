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

### `class-types.ts`
Same CRUD shape as locations. Archive is blocked if any non-archived `instructor_class_types` references the type, or any active future `classes` / `workshops` reference it.

### `instructors.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/instructors` | List with `?status=pending|active|archived`, joins `staff_users` |
| GET | `/instructors/:id` | Detail incl. `instructor_class_types` eligibility, photo presigned URL, recent ratings aggregate |
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

### `class-packages.ts`
| Method | Path | Notes |
|---|---|---|
| GET | `/class-packages` | List with `?status` |
| POST | `/class-packages` | Insert `class_packages` row. CHECK constraint enforces kind-specific column requirements (credits + validity_days for `credit_bundle`; duration_days for `unlimited`). |
| PATCH | `/class-packages/:id` | Edit only fields that don't affect already-purchased entitlements (name, status). Price changes apply to **future** purchases only — existing `client_packages` rows are immutable. |
| POST | `/class-packages/:id/archive` | Soft delete; existing client_packages remain valid until `expires_at`. |

### `pt-packages.ts`
Same shape as class-packages, with PT-specific fields.

### `schedule.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/schedule` | Unified timetable: union of `classes`, `workshops`, confirmed `pt_sessions`. Filter by `?location_id`, `?instructor_id`, `?class_type_id`, `?from`, `?to`. Each row carries `event_state` computed at read time (`scheduled / ongoing / completed / cancelled`) per `services/policy/event-state.ts`. |
| POST | `/schedule/classes` | Create class instance |
| PATCH | `/schedule/classes/:id` | Edit (rejects if any confirmed bookings AND material change, e.g. moving start time more than 15 min) |
| POST | `/schedule/classes/:id/cancel` | Admin cancellation — see §3b |
| POST | `/schedule/workshops` | Create workshop with tiers + images + instructors |
| PATCH | `/schedule/workshops/:id` | Edit (similar conservatism on bookings present) |
| POST | `/schedule/workshops/:id/cancel` | Admin cancellation + refund fanout — see §3b |

### `availability.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/instructors/:id/availability` | Returns recurring + one-off rows |
| POST | `/instructors/:id/availability/recurring` | Insert weekly slot |
| DELETE | `/instructors/:id/availability/recurring/:slotId` | Delete |
| POST | `/instructors/:id/availability/oneoff` | Insert one-off slot |
| DELETE | `/instructors/:id/availability/oneoff/:slotId` | Delete |

### `pt-sessions.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/pt-sessions` | List with filters; default `?status=pending` |
| POST | `/pt-sessions/:id/approve` | Confirm + book — see §3c |
| POST | `/pt-sessions/:id/decline` | Decline with `decline_note` (required) |
| POST | `/pt-sessions/:id/cancel` | Admin cancel a confirmed session — refunds session count to all clients in `pt_session_clients` |

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

### `inbox.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/inbox` | List with `?type`, `?read`. Default sort created_at desc |
| GET | `/inbox/unread-count` | For badge |
| POST | `/inbox/:id/mark-read` | Set `read_at`, `read_by_staff_id` |
| POST | `/inbox/:id/approve` | Only valid when `type='pt_request'` — calls `services/pt-sessions/approve.ts` (§3c) |
| POST | `/inbox/:id/decline` | Only valid when `type='pt_request'` — sets PT session `status='declined'` with note |

### `ratings.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/ratings` | All ratings with full attribution (client name, instructor name, session label). Filter by `?instructor_id`, `?class_id`, `?workshop_id`, `?from`, `?to` |
| GET | `/ratings/instructor/:id/aggregate` | Average + count by month for instructor profile |

### `clients.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/clients` | List with search, status filter |
| GET | `/clients/:id` | Profile incl. packages, booking history, cancellation count, attendance, referrals, waiver |
| POST | `/clients/:id/suspend` | Set `status='suspended'`, `suspended_at`. Calls Clerk `revokeAllSessions`. |
| POST | `/clients/:id/unsuspend` | Reverse |
| POST | `/clients/:id/credits/adjust` | `{ client_package_id, delta, reason }` — manual credit adjust. See §3d. |
| POST | `/clients/:id/sessions/adjust` | Same shape, for PT session balance |
| POST | `/clients/:id/packages/issue` | Admin grants a complimentary package. Inserts `client_packages` row with `amount_paid_sgd=0`, `stripe_payment_intent_id=NULL`. |

### `staff.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/staff` | List staff_users + open invitations |
| POST | `/staff/invite` | `{ email, role: 'admin' \| 'instructor' }` — see §3a |
| POST | `/staff/invitations/:id/revoke` | Set `status='revoked'`. Re-invite requires fresh row. |
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

### 3c. PT session approval

Triggered from: `POST /pt-sessions/:id/approve` OR `POST /inbox/:id/approve` (when item is a `pt_request`).

```
services/pt-sessions/approve.ts:approve({ pt_session_id, location_id, actor_staff_id })
  ↓
1. SELECT pt_sessions FOR UPDATE WHERE id=X AND status='pending'
2. Check instructor availability (recurring + one-off) covers [starts_at, ends_at]
   AND no other confirmed pt_session OR active class for this instructor overlaps
   → if conflict: 409 conflict
3. Update pt_sessions: status='confirmed', confirmed_at, confirmed_by_staff_id, location_id
4. Decrement client_packages.credits_or_sessions_remaining for each client in pt_session_clients
   (one PT package row per client; transaction fails if any client has zero remaining → 409 insufficient_pt_sessions)
5. Insert bookings row(s): kind='pt', pt_session_id=X, state='confirmed', credits_or_sessions_used=1
   per client in pt_session_clients (one booking per client)
6. Generate qr_token + code per booking via services/bookings/qr.ts
7. Mark inbox row (if any) action_taken='approved', action_at, action_by_staff_id
8. enqueueEmail('pt_session_approved', client.email, { instructor_name, starts_at, location, qr_url })
```

Decline path is simpler: set `status='declined'`, `decline_note`, and email `pt_session_declined`. Clients have to re-request.

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
| GET | `/pt-requests` | Pending PT requests where `instructor_id = ctx.instructor_id` |
| POST | `/pt-requests/:id/approve` | Calls §3c approve flow — service guards ownership |
| POST | `/pt-requests/:id/decline` | Service guards ownership |

### `availability.ts` (read-only in v1)
| Method | Path | Effect |
|---|---|---|
| GET | `/availability` | Own recurring + one-off slots |

Edit endpoints deferred per `admin-restructure.md` §19 — admin sets availability for instructors in v1.

### `profile.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/profile` | Own `instructors` row + name from `staff_users` |
| PATCH | `/profile` | Update bio, phone override, photo (R2 presigned upload). Eligible class types not editable — that's an admin operation. |

### `ratings.ts`
| Method | Path | Effect |
|---|---|---|
| GET | `/ratings` | Own ratings, **anonymized** — service strips `client_id`, `comment` returned as-is, no client-name attribution. |
| GET | `/ratings/aggregate` | Average + count by month |

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
