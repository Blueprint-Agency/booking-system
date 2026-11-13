# Audit 4: staff-facing API (portal + super portal)

Scope: every endpoint under `be/src/routes/portal/` (shared files, `admin/`, `instructor/`) and `be/src/routes/platform/`, traced into `be/src/services/*`. Read-only; nothing was run, so every statement count is from reading the code and every latency claim is marked SUSPECTED. Target load reasoned about: ~100 concurrent members + ~10 concurrent admins, several tenants, one backend process.

The audit was done in five parts (A-E); finding IDs carry the part letter. Totals: 72 findings: **no P0**, 22 P1, 30 P2, 20 P3.

## (a) How it works

- **One request = one transaction = one pooled connection.** `resolveTenant` (`be/src/middleware/tenant.ts:102`) wraps the whole handler in `withTenant` (`be/src/db/index.ts:59-83`): `BEGIN`, `set_config('app.tenant_id', …, true)`, the handler, `COMMIT`, then the after-commit work (mail) each in a transaction of its own, **all awaited before the response is sent**. Isolation is READ COMMITTED. A service's own `db.transaction` is a savepoint, so any row lock or advisory lock a service takes is held until the request's outer commit.
- **Consequences that recur in the findings.** (1) `Promise.all` over `db` inside a handler parallelises nothing: the statements pipeline on the one connection. (2) Anything slow inside a handler (Stripe, R2, a mail send, a 1,000-statement loop) pins a connection, and the pool is `postgres(url)` with no options (`be/src/db/index.ts:27`), i.e. the postgres.js default of 10, with no `statement_timeout` / `lock_timeout` / `idle_in_transaction_session_timeout` set in runtime code. Ten slow or lock-blocked requests stall every studio. Pool sizing is the DB auditor's, but it is what turns most P1s here from "slow" into "blocking".
- **Fixed per-request overhead on the portal:** `set_config` (1), staff session read, `staff_users` row (1), instructor permissions (1 for an instructor), impersonation lookup (+1 when the header is sent), audit row (+1 INSERT on a successful mutation) (`be/src/routes/portal/index.ts:31-44`, `be/src/middleware/audit.ts`).
- **Route shape** is as CLAUDE.md says: auth → zod → service → format. Role gates: `/portal/admin/*` admin only, `/portal/instructor/*` instructor or admin, the shared root files (attention, leave, profile, leave-calendar) any active staff.
- **Super portal** (`/api/v1/platform/*`) is exempt from tenant resolution; one gate (`requirePlatformAdmin`), and each service opens `withTenant` itself when it needs a studio's rows. Studio export/import run in the API process.
- **Concurrency model.** Member-vs-admin races on a class (capacity edit, cancel class, staff book/move, waitlist, check-in) serialise correctly on the class/booking row locks and the credit ledger's `FOR UPDATE` (see "Checked and fine", part B). What is missing is (i) any optimistic concurrency between two staff editing the same entity (last write wins everywhere), and (ii) the lock on a handful of paths that bypass the shared helpers (C-01, D-04, D-09, D-10).

### Top findings (read these first)

| ID | Sev | What |
|---|---|---|
| C-01 | P1 CONFIRMED | Manual credit adjust / set balance is an unlocked read-modify-write: a concurrent member booking's debit is lost (free credit), ledger `balance_after` stops adding up. The one money-correctness bug in the slice. |
| D-04 | P1 CONFIRMED | Two admins scheduling the same corporate request both succeed, leaving an orphan active session. D-05/D-06 same shape. |
| D-10 | P1 CONFIRMED mechanism | Workshop capacity not locked at purchase nor checked on day edit/delete (purchase side belongs to the member-API auditor). |
| E-03 | P1 | Replace-import rewrites every row of a studio that need not be suspended, in one long transaction; blocked member requests pin the 10-connection pool for all studios. |
| E-01 | P1 | Studio export/import run in the API process: whole tables in memory, sync JSON over hundreds of thousands of rows, up to 1 GiB archive buffered twice. Event-loop stalls and OOM risk for every studio. |
| C-02 / C-04 | P1 CONFIRMED | Finance list, overview and CSV export: no pagination, no date cap, up to 17 sequential queries (3 over the whole payment history), filtered/summed/sorted in JS; the overview runs it all again. |
| A-01 / A-03 | P1 | The bell summary is ~31-41 statements with no cache, polled every 60 s and refetched on navigation/focus; two of them aggregate the studio's whole payment history. |
| A-06 | P1 CONFIRMED | `GET /portal/admin/staff` is ~7 statements per staff member, takes `FOR NO KEY UPDATE` on every staff row and INSERTs leave pools, inside a read. |
| B-03 / B-07 | P1 | Class Series preview/commit run ~750-1,100 sequential statements holding room/instructor advisory locks; ending a series locks every future class and cancels them one by one. |
| B-04 / D-02 | P1 CONFIRMED | Cancel class / cancel workshop mail every attendee serially and the HTTP response waits for all of it. |
| C-05, C-06, A-08, A-09 | P1/P2 CONFIRMED | Stripe refunds, R2 uploads, mail sends and a logo fetch are awaited inside the request transaction (connection + row locks held across an outbound call). |
| B-01, D-01, A-07, A-10, C-07, D-03, D-07, D-12 | P1/P2 CONFIRMED | Unbounded lists: timetable with no window cap, PT queue history, instructor payroll, leave lists, receipts CSV, corporate lists, workshops, ClassPass review (with full email bodies). |
| C-03, B-11 | P1/P2 SUSPECTED | Member / receipt search is `ILIKE '%x%'` over three columns, no trigram index, 0-1 char minimum, run twice per request. |
| E-09 | P1 cross-slice | The authed rate limiter is mounted before auth, so it can only key on IP (or `'global'`): 300 req/min shared by everyone behind one studio's address. |
| A-14, B-08, C-11 | P2 CONFIRMED | No optimistic concurrency anywhere staff edit shared entities; the leave-conflict save is delete-all + insert. |


## (b) Endpoint inventory

Columns: Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict. Query counts exclude the fixed per-request overhead described in (a) unless a part says otherwise.

### Inventory A: Attention, leave, staff, instructor payroll, policy, impersonation, small settings

Paths are relative to `be/src/` unless they start with `fe-portal/`.

Context that applies to every row below (read, not guessed):

- Every studio request is ONE Postgres transaction on ONE pooled connection for its whole life (`middleware/tenant.ts:102` -> `db/index.ts:59-83`). `Promise.all` inside a handler therefore does not parallelise anything: the statements are pipelined on the same connection. "Queries/call" below is the service's own statements; add the fixed per-request overhead of `set_config` (1), staff session read (`readPoolSession`, not traced here, auth auditor's slice), `staff_users` row (1, `middleware/staff-auth.ts:66-76`), instructor permissions (1 for an instructor, 0 for an admin, `services/auth/instructor-permissions.ts:24-28`), `impersonate` (+1 only when the header is sent, `middleware/impersonate.ts:39-43`), `audit` (+1 INSERT on a successful mutation, `middleware/audit.ts:79`).
- The pool is `postgres(url)` with no options (`db/index.ts:27`), i.e. the driver default of 10 connections. Cross-slice (pool auditor), but it is what turns "a request holds its connection during X" into a real limit.

| Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| GET /portal/attention/summary | `attentionSummary` (`services/attention/index.ts:57`) | Admin: ~31 without `location_id`, ~41 with it (the portal always sends it). Instructor: ~6-10 | Counts only | 4 numbers + `by_group` | A-01, A-02, A-03, A-04: polled every 60 s + on every route change, recomputes everything, no cache |
| GET /portal/attention | `attentionPanel` (`index.ts:133`) | Admin: ~31 counts again + 1-6 per open kind for lists + 1 updates page; ~40-70 | `limit_per_group` 1..50; updates paged 20 by cursor | Composed copy only | A-05: several lists load every row then `slice` in JS; counts duplicated from summary |
| POST /portal/attention/dismissals | `dismissItem` (`dismissals.ts:20`) | 1 (locations) + 1-2 (`isOpen`) + insert + audit insert = 4-5 | n/a | 204 | Fine; race closed by `onConflictDoNothing` |
| POST /portal/attention/updates/read-all | `markAllUpdatesRead` (`updates.ts:348`) | 1 UPDATE | Scoped to recipient | 204 | Fine |
| POST /portal/attention/updates/:id/read | `markUpdateRead` (`updates.ts:333`) | 2 (select + update) | n/a | 204 | Fine (could be 1 statement; P3) |
| GET /portal/auth/me | inline (`routes/portal/auth.ts:18`) | 1 | Studio's locations | `select()` whole location rows incl. archived, filtered in JS | Fine; A-17 nit |
| GET /portal/leave-calendar | `listLeaveCalendar` (`services/leave/requests.ts:1049`) | 3 (rows, caps, conflict pairs) | NO cap on `from`..`to` span | Full `leave_requests` row selected per entry | A-11 |
| GET /portal/leave | `getOwnLeave` (`requests.ts:475`) | 6-7 incl. a `FOR NO KEY UPDATE` lock and an INSERT | Returns every request the person ever filed, all years | Whole rows | A-10, A-12 |
| POST /portal/leave | `submitLeaveRequest` (`requests.ts:530`) | ~15-20, row locks on applicant + partner instructors | n/a | 1 row | Fine: locks ordered, mail via `afterCommit` (`requests.ts:767`) |
| POST /portal/leave/:id/document | `attachSupportingDocument` (`requests.ts:830`) | 3 + R2 PUT inside the request transaction | 5 MB body limit | 1 row | A-08: connection held across an R2 upload (and a delete on the refusal path) |
| GET /portal/leave/:id/document | `supportingDocumentUrl` (`requests.ts:923`) | 1 + local signing | n/a | URL | Fine |
| POST /portal/leave/:id/withdraw, /cancel | `transitionOwnLeaveRequest` (`requests.ts:773`) | 2 (locked select, update) | n/a | 1 row | Fine: row locked `FOR NO KEY UPDATE` before the rule is checked |
| POST /portal/profile/photo | `setProfilePicture` (`services/profile-pictures/pictures.ts:30`) | 2-3 + R2 PUT inside the request transaction | 5 MB | URL | A-08 |
| DELETE /portal/profile/photo | `removeProfilePicture` (`pictures.ts:67`) | 2-3; object delete deferred via `afterCommit` | n/a | - | Fine |
| GET /portal/admin/leave | `listLeaveRequestsForAdmin` (`requests.ts:958`) | 1 | NO limit; `status=all` returns every request ever filed in the studio | Whole row + applicant | A-10 |
| GET /portal/admin/leave/:id/document | `supportingDocumentUrl` | 1 | n/a | URL | Fine |
| POST /portal/admin/leave/:id/approve, /reject, /revoke | `decideLeaveRequest` (`requests.ts:1188`) | ~5 (locked select, update, staff name, update row insert) | n/a | `{ok}` | Fine: row lock + status rule = two admins cannot both decide; mail via `afterCommit` (`requests.ts:1254`) |
| GET /portal/admin/staff | `listStaffAndInvitations` (`services/auth/invitations.ts:544`) + `pendingStaffEmails` | 5 + ~7 PER STAFF MEMBER (20 staff = ~145), every staff row locked, INSERTs in a GET | Unbounded (staff count is small) | Whole staff row incl. bio, address, phone for every member | A-06 |
| POST /portal/admin/staff/invite | `inviteAdmin` (`invitations.ts`, mail at :523) | several + Resend call awaited inside the request transaction | n/a | 1 row | A-09 |
| POST /portal/admin/staff/invitations/:id/revoke | `revokeInvitation` (`invitations.ts:599`) | ~4-6 in a savepoint | n/a | 1 row | Fine |
| POST /portal/admin/staff/invitations/:id/resend | `resendStaffInvitation` (`services/auth/account-access.ts:147`) | ~5 + mail inline (`invitations.ts:693`) | n/a | 1 row | A-09 |
| PATCH /portal/admin/staff/:id | `updateStaffProfile` (`services/auth/staff-archive.ts:313`) | ~12-25 (target, actor re-read, optional adjust, update, permissions, then `withLeaveFigures` for one = ~8, pending email 1) | n/a | 1 row | A-14 (no version check), A-16 (`bio`, `languages` unbounded) |
| POST /portal/admin/staff/:id/email | `startStaffEmailChange` (`services/auth/staff-email-change.ts:283`) | ~7 incl. advisory lock, + mail inline (:329) | n/a | small | A-09 |
| DELETE /portal/admin/staff/:id/email | `revokeStaffEmailChange` (:512) | ~4 | n/a | 204 | Fine |
| POST /portal/admin/staff/:id/archive | `archiveStaff` (`staff-archive.ts:117`) | ~7 + 2; last-admin check takes `FOR UPDATE` on the active admins (:91-103) | n/a | 1 row | Fine: last-admin race is closed by the lock |
| POST /portal/admin/staff/:id/unarchive | `unarchiveStaff` (:178) | ~5 | n/a | 1 row | Fine |
| GET /portal/admin/staff/:id/sessions | `listStaffSessions` (`account-access.ts:112`) | 2 | Unexpired sessions of one user; no LIMIT | 7 fields | Fine |
| POST /portal/admin/staff/:id/sessions/revoke | `signStaffOutEverywhere` (:125) | ~3 | n/a | count | Fine |
| POST /portal/admin/staff/:id/resend-invitation | `resendStaffSetPassword` (:186) | ~4 + mail inline (:216) | n/a | bool | A-09 |
| DELETE /portal/admin/staff/:id | `softDeleteStaff` (`staff-archive.ts:227`) | ~3 | n/a | 204 | Fine |
| GET /portal/admin/instructors | `listInstructors` (`services/catalog/instructors.ts:56`) | 1 | Unbounded (small table) | `select()` whole staff row, 10 fields serialised | Fine |
| POST /portal/admin/instructors | `createInstructor` (:94) | ~6 + Resend call awaited inside the request transaction (:145) | `bio` has no zod max (service asserts a bound, :100) | 1 row | A-09 |
| GET /portal/admin/emails | `listStudioEmails` (`services/notifications/switch-state.ts:31`) | 1 | Fixed registry | small | Fine |
| PATCH /portal/admin/emails/:slug | `setEmailSwitch` (:55) | 2 (upsert + own audit row) + the middleware's audit row | n/a | small | Fine; possibly audited twice (route does not set `auditFiled`, `routes/portal/admin/emails.ts:17-19`) - P3, see A-17 |
| GET /portal/admin/marketing | `getMarketing` (`services/marketing.ts:38`) | 1 | 1 row | small | Fine |
| PATCH /portal/admin/marketing | `updateMarketing` (:48) | 1 | zod caps on every field, testimonials <= 20 | 1 row | A-14 (whole-document replace, last write wins) |
| GET /portal/admin/feature-flags | `listFlags` (`services/feature-flags.ts:42`) | 1 | Per tenant | small | Fine |
| PATCH /portal/admin/feature-flags/:key | `setFlag` (:50) | 1 upsert | n/a | small | A-15: process-local cache written before commit |
| GET /portal/admin/settings/business-details | `readBusinessDetails` (`services/tenants/business-details.ts:134`) | 2 | 1 row | small | Fine |
| PUT /portal/admin/settings/business-details | `saveBusinessDetails` (:171) | 1 upsert + read | n/a | small | A-14 |
| GET /portal/admin/policy | `readPolicy` + `readLeaveConflicts` (`services/policy/update.ts:16`, :215) | 3 | 1 row + pairs | small | Fine |
| PATCH /portal/admin/policy/global | `updateGlobalPolicy` (:100) | 2 without pairs; with pairs: update, lock all instructor rows, 2 reads, delete, insert, read = ~7 | `leave_conflicts` array has no `.max()` (`routes/portal/admin/policy.ts:61-69`) | row + pairs | A-13, A-16 |
| PATCH /portal/admin/policy/pt | `updatePtBookingConfig` (:226) | 2 (locked select, update) | zod 1..365 | 1 row | Fine |
| POST /portal/admin/clients/:id/impersonate | `mintClientImpersonation` (`services/impersonation/mint.ts:41`) | 1 + session insert(s) | n/a | token + url | Fine |
| GET /portal/instructor/profile | `getInstructor` (`catalog/instructors.ts:39`) | 1 | 1 row | small | Fine |
| PATCH /portal/instructor/profile | `updateInstructor` (:170) | 2-3 | zod has no max on `bio`/`phone` (`routes/portal/instructor/profile.ts:18-21`); service asserts bounds (`instructors.ts:100`, `PHONE_MAX` :156) | 1 row | A-16 nit |
| GET /portal/instructor/payroll | `getPayroll` -> `listPayroll` (`services/payroll/list.ts:324`) | 6 sequential (5-table joins each) | NO: `from`/`to` optional, no LIMIT; default is the instructor's whole history | 11 fields per line, every line | A-07 |

`routes/portal/surface.ts` and `routes/portal/session-view.ts` define a type and a serialiser; they mount no endpoint.

### Inventory B: Schedule, bookings, check-in, waitlist, catalog

Paths are relative to `be/src/`. "Queries/call" counts statements issued by the handler + service only (not the auth/tenant/audit middleware, which another auditor covers). Every request is one transaction opened by `middleware/tenant.ts:102` (`withTenant`), READ COMMITTED; a service `db.transaction` is a savepoint (`db/index.ts:232-246`), so **every lock a service takes is held until the request's outer COMMIT**, and the request holds one pooled connection for its whole life (`db/index.ts:50-56`; pool is `postgres(url)` with no explicit `max`, `db/index.ts:27` — cross-slice, pool auditor).

Admin mounts are under `/api/v1/portal/admin`, instructor mounts under `/api/v1/portal/instructor`.

| Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| GET admin `/schedule` (timetable; also the Schedule List view) | `timetable.listSchedule` (`services/schedule/timetable.ts:75`) | 12 sequential when no `type` filter: classes 4 (rows, seats, waiting rows, supporting), workshops 4, PT 3, corporate 2 (one fewer where a kind is empty) | **No.** `from`/`to` optional, no max span (`routes/portal/timetable-read.ts:40-44`); no LIMIT | ~20 fields/entry, whole range in one array; waitlist rows fetched and counted in JS | B-01, B-02, B-13 |
| GET instructor `/schedule` | same, `instructorId` forced | 12 | **No** (same schema) | same; workshop-instructor filter applied in JS after loading every workshop day | B-01, B-02 |
| GET admin `/schedule/classes/:id` | `detail.getClassDetail` (`services/schedule/detail.ts:105`) | 10 + 1 per waiting member (+2 if rule has a list): row, seats, attendees, policy, cancelled bookings, rule, waitlist line (2), **candidatePackages per entry**, supporting, nameRule | Per class; cancelled-bookings list uncapped | Full roster + cancelled bookings + waitlist with per-member pay status | B-06 |
| GET instructor `/sessions/class/:id/roster` | `detail.getOwnClassDetail` (`detail.ts:323`) | same as above; ownership checked **after** the whole detail is built | Per class | Admin-only fields stripped in the route | B-06, B-16 |
| GET admin `/schedule/pt/:id` | `detail.getPtSessionDetail` (`detail.ts:383`) | 3 | Yes | small | OK |
| GET instructor `/sessions/pt/:id/roster` | `detail.getOwnPtSessionDetail` | 3 | Yes | small | OK |
| GET instructor `/clients?q=` | `clients/manage.searchClients` (`services/clients/manage.ts:223`) | 1 | LIMIT 10; `q` min 1, max 100 | `select()` whole client row for 3 fields | B-11 |
| POST admin+instructor `/schedule/classes` | `classes.createClass` (`services/schedule/classes.ts:78`) + `adminClassJson` | ~25–40: room, class type, advisory locks (1 + n), occupancy 4 per room / 5–13 per instructor, rule, ensureInstructors 2, insert, roster ~6, session-assigned ~4, then 3–4 re-reads for the response | n/a; `supporting_instructors`, `package_rule.package_ids` arrays uncapped | whole row | OK (B-10 bounds, B-15 re-reads) |
| PATCH admin `/schedule/classes/:id` | `classes.updateClass` (`classes.ts:197`) / `previewClassRuleChange` | ~20–40; + a full `cancelBookingInTx` (~15–25 stmts) per booking the new rule refuses | n/a | whole row | Locking correct; B-08 (no version), B-09 (buffer/waitlist floor) |
| POST admin `/schedule/classes/:id/cancel` | `cancel-class.cancelClass` (`services/bookings/cancel-class.ts:55`) | ~12 fixed + **≥3 per confirmed booking** (refund ledger writes, insert cancellation, update booking), then one e-mail per booking sequentially before the response | Per class | counts only | B-04, B-05 |
| POST instructor `/schedule/classes/:id/cancel` | same, `source:'instructor'` | same + admin Update + admin e-mails | Per class | counts only | B-04, B-05 |
| POST admin `/schedule/workshops/:id/cancel` | `workshops/cancel.cancelWorkshop` | not traced here (workshops are part of another sub-slice) | — | workshop row | see other part |
| POST admin+instructor `/schedule/series/preview` | `series.previewSeries` (`services/schedule/series.ts:124`) | **4 + N×(4 + 5×(1+k))** minimum, sequential: N = occurrences (≤53), k = supporting instructors. 53 weeks, k=1 → ~745; more for every date that has an overlapping event | Range ≤ 366 days (`series.ts:64,623`); `excluded_dates`, `supporting_instructors` uncapped | every date + clashes | B-03, B-10 |
| POST admin+instructor `/schedule/series` | `series.createSeries` (`series.ts:135`) | preview cost again inside the commit (`series.ts:545`) + insert + **6 per class** when there are supporting instructors (`series.ts:580-585`) ≈ **1,050–1,100 statements** for a year with one supporting instructor; then `getSeries` 3–4 | same | series + all class ids | B-03 |
| GET admin `/schedule/series/:id` | `series.getSeries` → `loadSeries` (`series.ts:445`) | 3–4 | Yes | small | OK |
| POST admin `/schedule/series/:id/extend/preview` | `series.previewExtend` | loadSeries 3–4 + taken-dates 1 + same per-date scan as create preview | ≤ 366 days | dates + clashes | B-03 |
| POST admin `/schedule/series/:id/extend` | `series.extendSeries` (`series.ts:243`) | as create commit; series row locked `FOR UPDATE` (`series.ts:452`) | ≤ 366 days | series + class ids | B-03 |
| PUT admin `/schedule/series/:id/package-rule` | `series.setSeriesRule` (`series.ts:428`) | ~8 | `package_ids` uncapped | series | OK (B-10) |
| POST admin `/schedule/series/:id/end` | `series.endSeries` (`series.ts:350`) | 5 + **~12–15 per unbooked future class** (`cancelClassInTx` loop, `series.ts:404-406`) ≈ 600–800 for a year; all future classes of the series held `FOR UPDATE`; one after-commit transaction per cancelled class | ≤ series length | ids + booked list | B-07 |
| GET admin+instructor `/schedule/classes/:id/packages?client_id=` | `book.staffPackagesForClass` (`services/bookings/book.ts:603`) | 4–6 | Per member | small | OK |
| POST admin+instructor `/schedule/classes/:id/bookings` | `book.staffBookClass` → `bookIntoClass` (`book.ts:118`) | ~15–20, class row `FOR UPDATE` first | n/a | booking codes | OK — race-safe |
| POST admin+instructor `/schedule/classes/:id/waitlist` | `waitlist/entries.join` | ~10, class lock first | n/a | entry id + position | OK |
| POST admin+instructor `/schedule/classes/:id/waitlist/:entryId/promote` | `waitlist/staff.staffPromote` (`services/waitlist/staff.ts:130`) | ~18–22, class lock first | n/a | booking codes | OK |
| DELETE admin+instructor `/schedule/classes/:id/waitlist/:entryId` | `waitlist/staff.staffRemove` (`staff.ts:192`) | 3 | n/a | 204 | OK |
| POST admin+instructor `/bookings/:id/cancel` | `cancel.cancelBooking` (`services/bookings/cancel.ts:118`) | ~15–25 (+ a full `payAndBook` per promoted waiter); retried on deadlock up to 4× (`db/index.ts:197`) | n/a | outcome | OK — parent locked before booking |
| POST admin `/bookings/:id/no-show` | `no-show.markNoShow` (`services/bookings/no-show.ts:23`) | 4–5, booking `FOR UPDATE` | n/a | `{ok}` | OK |
| GET admin+instructor `/check-in?date=&location_id=` | `check-in.listCheckInDay` (`services/bookings/check-in.ts:416`) | 5–6 (policy, classes, PT, roster, waiting, names); timezone cached | One studio day | every roster row of the day incl. photo URL, code | OK; B-12 (plan shape, JS grouping) |
| POST admin+instructor `/check-in/scan` | `check-in.scanCheckIn` (`check-in.ts:306`) | 6–7; lookups ride `bookings_qr_token_unique` / `bookings_code_unique` (`db/schema/bookings.ts:108-109`) | n/a | member + session | OK |
| POST admin+instructor `/check-in/manual` | `check-in.markAttendance` (`check-in.ts:238`) | 5–6 | n/a | state | OK |
| GET admin `/locations` | `catalog/locations.listLocations` | 1 | Unbounded, tiny table | 6 fields | OK |
| GET admin `/locations/:id` | `getLocation` | 1 | Yes | — | OK |
| POST admin `/locations` | `createLocation` | 1 | n/a | — | OK |
| PATCH admin `/locations/:id` | `updateLocation` (`services/catalog/locations.ts:67`) | 2 (read then write, no lock) | n/a | — | B-14 |
| GET admin `/locations/:id/live-unlimited-count` | `packages/purchase.countLiveUnlimitedAtLocation` | 1 (`count(*)`) | Yes | number | OK |
| POST admin `/locations/:id/archive` | `archiveLocation` (`locations.ts:85`) | 5 (3 blocker reads return every id) | Blocker reads unbounded | — | B-14 |
| POST admin `/locations/:id/unarchive` | `unarchiveLocation` | 2 | n/a | — | OK |
| DELETE admin `/locations/:id` | `softDeleteLocation` | 2+ | n/a | — | OK |
| GET admin `/rooms` | `catalog/rooms.listRooms` | 1 | Unbounded, tiny table | 5 fields | OK |
| GET admin `/rooms/:id` | `getRoom` | 1 | Yes | — | OK |
| POST admin `/rooms` | `createRoom` | 2 | n/a | — | OK |
| PATCH admin `/rooms/:id` | `updateRoom` (`services/catalog/rooms.ts:74`) | 2 (read then write, no lock) | n/a | — | B-14 |
| POST admin `/rooms/:id/archive` | `archiveRoom` (`rooms.ts:135`) | 5 (`gatherLinkedDataBlockers`, `rooms.ts:92-133`, returns every future id) | Blocker reads unbounded | — | B-14 |
| POST admin `/rooms/:id/unarchive` | `unarchiveRoom` | 2 | n/a | — | OK |
| DELETE admin `/rooms/:id` | `softDeleteRoom` | 2+ | n/a | — | OK |
| GET admin `/class-types` | `catalog/class-types.listClassTypes` | 1 | Unbounded, small table | 6 fields | OK |
| GET admin `/class-types/:id` | `getClassType` | 1 | Yes | — | OK |
| POST admin `/class-types` | `createClassType` | 2–4 | n/a | — | OK |
| PATCH admin `/class-types/:id` | `updateClassType` (`services/catalog/class-types.ts:115`) | 2–5 (read then write, no lock) | n/a | — | B-14 |
| POST admin `/class-types/:id/archive` | `archiveClassType` | 4 | Blocker reads unbounded | — | B-14 |
| POST admin `/class-types/:id/unarchive` | `unarchiveClassType` | 2 | n/a | — | OK |
| DELETE admin `/class-types/:id` | `softDeleteClassType` | 2+ | n/a | — | OK |
| GET instructor `/catalog/class-types` | `listClassTypes` | 1 | small table | 3 fields | OK |
| GET instructor `/catalog/class-packages` | `packages/class-packages.listClassPackages` | 1 (archived included by design) | small table | 4 fields | OK |
| GET instructor `/catalog/features` | `waitlist/line.waitlistEnabled` | 0 (in-memory flag) | — | 1 boolean | OK |
| GET instructor `/catalog/rooms` | `listRooms` | 1 | small table | 4 fields | OK |

`routes/portal/parse.ts` and `routes/portal/class-package-rule.ts` define no endpoints (shared zod shapes only); `routes/portal/class-detail.ts` and `class-seats.ts` are serializers.

### Inventory C: Clients, finance, purchases, receipts, package catalogue, promo codes, merch

All paths are relative to `be/src/`. Every route is under `/api/v1/portal/admin` (admin role only).
Context that applies to every row: a request is ONE transaction on ONE pooled connection (`middleware/tenant.ts:102` -> `withTenant`, `db/index.ts:61`), at READ COMMITTED; a service's `db.transaction` is a savepoint. `Promise.all` over `db` therefore pipelines on one connection, it does not parallelise. The pool is `postgres(url)` with no options (`db/index.ts:27`), i.e. the postgres.js default of 10 connections, and no `statement_timeout` / `lock_timeout` / `idle_in_transaction_session_timeout` is set anywhere in runtime code (cross-slice, belongs to the pool auditor, but it is what turns the findings below from slow into blocking).

Query counts are statements issued by the handler and service, excluding the middleware's own (`set_config`, auth, audit row). "+tz" style reads that hit the in-process tenant cache are not counted.

| Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| GET /clients | `listClientsPage` (clients/manage.ts:130) | 3 (count, page, trial facts); 4 with `filter=trials` (funnel) | Yes: page_size <= 200, default 50 (routes/portal/admin/clients.ts:82-99). `q` max 200, no min | Whole `clients` row per member + 3 trial facts | OK shape; search is unindexed ILIKE (C-03), funnel recomputed per page (C-09) |
| POST /clients | `createClient` (manage.ts:329) | ~7 + 1 mail HTTP call inline | n/a | one row | Mail provider call inside the request transaction (C-06); check-then-insert on email (C-15) |
| GET /clients/:id | route fan-out (clients.ts:465-524) | ~24-28 | Lists capped at 50/100 each (member-history.ts:109,121; manage.ts:272; member-payments.ts:41). Packages, workshop purchases, open purchases uncapped but per member | Very wide: 10 collections in one body | Works; redundant reads (C-08) |
| GET /clients/:id/packages/:pid/credit-history | `creditHistory` (packages/credit-history.ts:44) | 2 | No LIMIT, bounded by one package's movements | small | Fine |
| POST /clients/:id/packages/:pid/adjust | `adjustBalance` (packages/adjust.ts:76) | 6 | n/a | row | Lost update, no row lock (C-01) |
| POST /clients/:id/packages/:pid/balance | `setBalance` (adjust.ts:137) | 8 | n/a | row | Same, plus delta from a stale read (C-01) |
| POST /clients/:id/packages/:pid/expiry | `setPackageExpiry` (adjust.ts:429) | ~10 | n/a | row | Locks the row FOR UPDATE first (adjust.ts:435-439): correct |
| POST /clients/:id/packages/:pid/bound-instructor | `setBoundInstructor` (adjust.ts:324) | ~8 | n/a | row | No lock, last write wins (C-11) |
| POST /clients/:id/packages/:pid/cross-location | `setCrossLocationAddOn` (adjust.ts:176) | 6 | n/a | row | No lock, last write wins (C-11) |
| POST /clients/:id/packages/:pid/location | `setHomeLocation` (adjust.ts:231) | ~9 + 2 per plan moved | n/a | row | No lock (C-11) |
| POST /clients/:id/packages/:pid/refund | `issueRefund` (billing/refunds.ts:481) | ~8 + 1 Stripe call and 1 UPDATE per payment | n/a | small | Stripe calls inside the request transaction (C-05); idempotency key present |
| POST /clients/:id/workshop-bookings/:bid/refund | `issueWorkshopRefund` (refunds.ts:729) | ~4 + 1 Stripe call and 1 UPDATE per payment | n/a | small | Same (C-05) |
| POST /clients/:id/packages/issue | `giveComplimentaryPackage` (packages/complimentary.ts:65) | ~8-10 | n/a | id | Fine |
| POST /clients/:id/packages/:pid/remove | `removeComplimentaryPackage` (complimentary.ts:152) | ~12 + a full `cancelBooking` per live booking, in a loop (complimentary.ts:345-354) | Only by the package's own bookings | counts | Retried transaction, correct locking; per-booking loop is inherent |
| POST /clients/:id/email | `changeClientEmail` (clients/change-email.ts:43) | ~8 + 1 Stripe `customers.update` per provider customer | n/a | row | Stripe call inside the request transaction (C-05) |
| PATCH /clients/:id/profile | `editClientProfile` (clients/edit-profile.ts:37) | 3 | n/a | row | Read-then-write, last write wins (C-11) |
| DELETE /clients/:id | `softDeleteClient` (manage.ts:408) | ~4 | n/a | row | Fine, idempotent |
| POST /clients/:id/restore | `restoreClient` (manage.ts:455) | 3 | n/a | row | Fine, idempotent |
| DELETE /clients/:id/permanently | `deleteMemberPermanently` (clients/member-delete.ts:37) | ~2 statements per member table (10+ tables) + 1 Stripe `customers.del` per provider customer | By one member's rows | flag | Rare; Stripe inside the transaction and a false "never throws" (C-05, C-13) |
| GET /clients/:id/sessions | `listMemberSessions` (auth/account-access.ts:44) | 2 | per member | small | Fine |
| POST /clients/:id/sessions/revoke | `signMemberOutEverywhere` (account-access.ts:50) | 3 | n/a | count | Fine |
| POST /clients/:id/send-set-password | `sendMemberSetPasswordLink` (account-access.ts:74) | ~3 + mail HTTP inline | n/a | flag | Mail inside the request transaction (C-06) |
| GET /clients/:id/export | `exportMember` + `packArchive` (clients/member-export.ts:22) | 2 + one `SELECT *` per member table, sequential (member-export.ts:36-42) | By one member's rows; no row cap | Zip built fully in memory | Rare and small; snapshot not consistent (C-14) |
| GET /finance | `getFinance` (finance/list.ts:570) | up to 17 sequential (6 payroll arms, payroll/list.ts:330-378; 11 money-in, list.ts:138-344) | NO: no pagination, `from`/`to` optional, no range cap (routes/portal/admin/finance.ts:44-58) | Every Money Event in the range, ~25 fields each, plus totals | Unbounded read and in-memory aggregation (C-02) |
| GET /finance/overview | `getFinanceOverview` (finance/overview.ts:256) | the whole of `getFinance` (up to 17) + 5 | NO: same optional range | Aggregates only, but computed from every row | Runs the full ledger read to return 5 numbers (C-02, C-04) |
| GET /finance/export | `getFinance` + `financeCsv` (finance.ts:128) | up to 17 | NO | Whole CSV as one in-memory string | Unbounded, not streamed (C-02); formula injection (C-10) |
| POST /finance/manual | `createManualPayroll` (payroll/list.ts:497) | 2 | n/a. `label` has no max length (finance.ts:82) | id | Add `.max()` (C-12) |
| DELETE /finance/manual/:id | `deleteManualPayroll` (payroll/list.ts:523) | 1 | n/a | flag | Fine |
| PATCH /finance/pay/:kind/:id | `updatePayrollAmount` (payroll/list.ts:439) | 1 (manual) or 2-4 (roster) | n/a | flag | Last write wins on a single column, acceptable |
| GET /purchases/silent | `listSilentPartPaidPurchases` (billing/open-purchases.ts:586) | 2 | NO, unpaginated on purpose (purchases.ts:61-63) | Whole `purchases` row selected per item | Acceptable; small by nature |
| POST /purchases/:id/refund | `issueOpenPurchaseRefund` (refunds.ts:981) | ~5 + up to 2 Stripe checkout calls + 1 Stripe refund and 1 UPDATE per payment | n/a | small | Holds a `purchases` row lock FOR UPDATE across Stripe calls (C-05) |
| GET /receipts | `listStudioReceipts` (receipts/read.ts:162) | 2 (page, count) | Yes: page_size <= 100 (routes/receipt-views.ts:21-30). `q` max 200, no min | Summary sent, but the query selects whole rows incl. `lines`/`bill_to` JSONB (read.ts:137-139) | Unindexed ILIKE x3 (C-03); over-fetch (C-12) |
| GET /receipts/export.csv | `exportStudioReceipts` (read.ts:175) | 1 | NO: no LIMIT, date range optional | Every receipt row whole, CSV as one string | Unbounded (C-07) |
| GET /receipts/:id | `studioReceipt` + `receiptDetailView` | 1-2 | n/a | fields + rendered HTML page | Fine |
| GET /receipts/:id/pdf | `studioReceipt` + `receiptPdf` (receipts/pdf.ts:28) | 1-2 + an uncached HTTP fetch of the studio logo (receipts/logo.ts:36) + pdfkit render | n/a | PDF buffer | Outbound fetch and CPU render inside the transaction (C-06) |
| POST /receipts/:id/resend | `resendReceipt` (receipts/resend.ts:34) | ~5 + PDF render + mail HTTP inline | n/a | address | Mail inside the request transaction (C-06) |
| GET /class-packages | `listClassPackages` + `listManagedPromotionsFor` | 2 | No LIMIT; catalogue-sized | whole rows + promotions | Fine |
| GET /class-packages/:id | `getClassPackage` + promotions | 2 | n/a | row | Fine |
| POST /class-packages | `createClassPackageWithPromotions` (class-packages.ts:106) | 2 + 1 per promotion + 1 re-read | `promotions` array has no max (routes/portal/admin/package-fields.ts:62) | row | Cap the array (C-12) |
| PATCH /class-packages/:id | `updateClassPackageWithPromotions` (class-packages.ts:170) | 3 + 1 per promotion archived/updated/inserted (promotions.ts:183-217) + 1 re-read | same | row | Read-then-write, no version check (C-11) |
| POST /class-packages/:id/archive | `archiveClassPackage` | 3 | n/a | row | Fine |
| POST /class-packages/:id/unarchive | `unarchiveClassPackage` | 3 | n/a | row | Fine |
| DELETE /class-packages/:id | `softDeleteClassPackage` | 2 | n/a | 204 | Fine |
| GET /pt-packages | `listPtPackages` + promotions | 2 | catalogue-sized | whole rows | Fine |
| GET /pt-packages/:id | `getPtPackage` + promotions | 2 | n/a | row | Fine |
| POST /pt-packages | `createPtPackageWithPromotions` | 2 + 1 per promotion + 1 | promotions uncapped | row | C-12 |
| PATCH /pt-packages/:id | `updatePtPackageWithPromotions` | 3 + 1 per promotion + 1 | same | row | C-11 |
| POST /pt-packages/:id/archive | `archivePtPackage` | 3 | n/a | row | Fine |
| POST /pt-packages/:id/unarchive | `unarchivePtPackage` | 3 | n/a | row | Fine |
| DELETE /pt-packages/:id | `softDeletePtPackage` | 2 | n/a | 204 | Fine |
| GET /corporate-packages | `listCorporatePackages` | 1 | catalogue-sized | whole rows | Fine |
| GET /corporate-packages/:id | `getCorporatePackage` | 1 | n/a | row | Fine |
| POST /corporate-packages | `createCorporatePackage` | 1 | n/a | row | Fine |
| PATCH /corporate-packages/:id | `updateCorporatePackage` then archive/unarchive (routes/portal/admin/corporate-packages.ts:76-104) | 2-4 (each step re-reads the row) | n/a | row | Redundant re-reads, harmless |
| POST /corporate-packages/:id/unarchive | `unarchiveCorporatePackage` | 2 | n/a | row | Fine |
| DELETE /corporate-packages/:id | `softDeleteCorporatePackage` | 2 | n/a | 204 | Fine |
| GET /promo-codes | `listPromoCodes` (packages/promo-code-admin.ts:118) | 3 | No LIMIT: every code ever, with scope rows and counts; JS `filter`/`find` per code (promo-code-admin.ts:157-161) | whole rows | Fine at catalogue size; O(codes x scope rows) in JS (C-12) |
| GET /promo-codes/products | `listScopableProducts` (promo-code-admin.ts:411) | 3 | No LIMIT; every active package and workshop | id+name | Fine |
| GET /promo-codes/:id | `getPromoCode` | 3 | n/a | row | Fine |
| POST /promo-codes | `createPromoCode` (promo-code-admin.ts:248) | 1 per product type + 2 | `products` array has no max (routes/portal/admin/promo-codes.ts:44,55) | row | Cap the array (C-12) |
| PATCH /promo-codes/:id | `updatePromoCode` (promo-code-admin.ts:314) | 3 + checks + 3 | same | row | Terms frozen after first redemption: good. No version check (C-11) |
| POST /promo-codes/:id/archive | `archivePromoCode` | 4 | n/a | row | Fine |
| GET /merch | `listMerch` (catalog/merch.ts:25) | 1 | No LIMIT; catalogue-sized | whole rows | Fine |
| POST /merch | `createMerch` | 1 | n/a | row | Fine |
| PATCH /merch/:id | `updateMerch` | 2 | n/a | row | Fine |
| POST /merch/:id/image | `setMerchImage` (merch.ts:88) | 2 + R2 `putObject` inline | `bodyLimit` set (routes/portal/admin/merch.ts:87) | row | Object-store upload inside the request transaction (C-06) |
| DELETE /merch/:id | `deleteMerch` | 2 | n/a | 204 | Fine |

`routes/portal/admin/refund-view.ts` and `package-fields.ts` define no endpoints (a response shaper and shared zod fields).

### Inventory D: PT sessions, corporate, workshops, ClassPass

Paths are relative to `be/src/`. Query counts are statements issued by the handler + service, read from the code; they exclude the request's own `set_config`, the auth/tenant middleware and the audit row. "~" means the count depends on a branch. Every request is one transaction (`db/index.ts:59-86`), so a service `db.transaction` is a savepoint and every row/advisory lock is held until the request ends.

| Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| GET /portal/admin/pt-sessions?status=&location_id= | `listPtRequestsForAdmin` (`services/pt-sessions/list.ts:657`) | 1 (8-table join) + up to 4 batched hydrations (partners, slots, bookings, sessionless returns) = 3-5 | NO. `status=all` or any terminal status returns every request ever made; no limit, no date range (`routes/portal/pt-request-routes.ts:254-263`, `list.ts:661-664`) | Each row: client name/email/photo, message, notes, slots[], session | D-01 |
| GET /portal/instructor/pt-requests | same, `status: 'pending', visibleToInstructorId` | 3-5 | Naturally bounded (pending only, requests expire) but no explicit limit | same | OK |
| GET /portal/{admin/pt-sessions,instructor/pt-requests}/seat-candidates | `listSeatCandidates` (`pt-sessions/manual.ts:969`) | 2 | Bounded by one member's PT packages | small | OK |
| POST …/manual | `createManualPtSession` (`manual.ts:329`) + `getPtRequestForAdmin` | ~30-45 (per member: assertMember x2, seated read, advisory lock, clash read, sweepExpired, package lock, 3 inserts, debit, activation; plus occupancy locks, roster, attention) + 3-5 re-read | members capped at 2 by session type (`pt-manual.ts` `.min(1)`; no `.max` in zod, service refuses) | returns full hydrated request | OK (see D-13 for zod cap) |
| POST …/:id/schedule | `schedulePtRequest` (`pt-sessions/schedule.ts:118`) + `getPtRequestForAdmin` | ~20-28 | n/a | hydrated request | OK — locked correctly (`schedule.ts:159-165`) |
| POST …/:id/cancel | `cancelPtRequest` (`pt-sessions/cancel.ts:106`) + `getPtRequestForAdmin` | ~15-25; mail after commit | n/a | hydrated request + result | OK — `FOR UPDATE` on request, session, bookings; retried on deadlock |
| POST …/sessions/:id/members | `addManualPtSessionMember` (`manual.ts:429`) | ~20 | n/a | small | OK |
| DELETE …/sessions/:id/members/:clientId | `removeManualPtSessionMember` (`manual.ts:822`) | ~15 | n/a | small | OK |
| GET /portal/admin/pt-sessions/:id | `getPtRequestForAdmin` (`list.ts:681`) | 3-5 | single row | hydrated | OK |
| PATCH /portal/admin/pt-sessions/sessions/:id | `updatePtSession` (`schedule.ts:522`) + `getPtSessionDetail` | ~20-40 depending on patch (two seated reads + two `lockMemberTime` passes when moved, `readInstructors` x2, `ptSubject`, roster) | `supporting_instructors` array has no max (`routes/portal/admin/pt-sessions.ts:45`) | session detail | OK on concurrency (request → session → room locks); D-13 |
| POST /portal/admin/pt-sessions/:id/link-partner | `linkPtRequestPartner` (`pt-sessions/request.ts:291`) + re-read | 3 + 3-5 | n/a | hydrated request | OK (locked); partner lookup is `lower(email) =` — see D-14 |
| GET /portal/admin/corporate-sessions?from=&to=&location_id= | `listCorporateSessions` (`corporate/sessions.ts:185`) | 1 | NO. `from`/`to` optional, no limit (`routes/portal/admin/corporate-sessions.ts:11-15`) | whole rows (`select()`) | D-03 |
| GET /portal/admin/corporate-sessions/:id | `getCorporateSession` (`sessions.ts:154`) | 2 | single | whole row + supporting ids | OK |
| PATCH /portal/admin/corporate-sessions/:id | `rescheduleCorporateSession` (`sessions.ts:251`) | ~10-18 | `supporting_instructor_ids` no max | whole row | D-05 (unlocked read, no lifecycle check) |
| POST /portal/admin/corporate-sessions/:id/cancel | `cancelCorporateSession` (`sessions.ts:201`) | 2 | n/a | whole row | OK — conditional UPDATE is the guard |
| GET /portal/admin/corporate-requests?status= | `listCorporateRequests` (`corporate/requests.ts:235`) | 1 (6-table join) | NO. `status=all` / terminal statuses unbounded (`routes/portal/admin/corporate-requests.ts:15-17`) | client email/photo per row | D-03 |
| GET /portal/admin/corporate-requests/:id | `getCorporateRequest` | 1 | single | — | OK |
| POST /portal/admin/corporate-requests/:id/schedule | `scheduleCorporateRequest` (`requests.ts:306`) + `getCorporateRequest` | ~15-20 | `supporting_instructor_ids` no max | hydrated | D-04 (double-schedule race) |
| POST /portal/admin/corporate-requests/:id/cancel | `cancelCorporateRequest` (`requests.ts:377`) + re-read | 3-5 | n/a | hydrated | D-06 (unlocked read-then-write) |
| POST /portal/admin/corporate-requests/:id/attended | `markCorporateRequestAttended` (`requests.ts:403`) + re-read | 3 | n/a | hydrated | D-06 |
| GET /portal/admin/workshops?lifecycle= | `listWorkshops` + `listInstructorsByWorkshop` (`workshops/publish.ts:257,272`) | 2 | NO. Every workshop ever, no limit, no ORDER BY | `select()` incl. `description_html` (up to 20 000 chars each) the list never shows | D-07 |
| GET /portal/admin/workshops/:id | `getWorkshopDetail` (`publish.ts:292`) + `listManagedPromotionsFor` | 6 sequential + promotions | single | fine | P3: 6 independent reads issued sequentially (cannot be `Promise.all` on one tx connection anyway; could be 2 joined reads) |
| POST /portal/admin/workshops | `createWorkshopWithSchedule` (`workshops/schedule.ts:28`) | ~10 + ~8 per day + ~7 per tier + promotions | NO array caps on `days`, `tiers`, `tiers[].day_refs`, `promotions`, `image_r2_keys`, `supporting_instructors` (`routes/portal/admin/workshops.ts:54-55,112-123,137-139`) | row | D-08, D-13 |
| PATCH /portal/admin/workshops/:id | `updateWorkshop` (basics only, `publish.ts:147`) or `updateWorkshopWithSchedule` (`schedule.ts:73`) | basics ~10-15; with schedule add ~10 per day + ~9 per tier | same uncapped arrays | row | D-08 (statements + lock span), D-09 (basics-only path unlocked) |
| POST /portal/admin/workshops/:id/cancel | `cancelWorkshop` (`workshops/cancel.ts:23`) | ~8 in-tx (bookings cancelled by ONE bulk UPDATE); then N emails after commit | attendees unbounded | row | In-tx part OK; D-02 for the mail tail |
| PUT /portal/admin/workshops/:id/schedule | `saveWorkshopSchedule` (`schedule.ts:121`) | ~10 per day + ~9 per tier + 4 | uncapped arrays | days + tiers | D-08 |
| GET /portal/admin/workshops/:id/days | `listDays` (`workshops/days.ts:41`) | 2 | by workshop | whole rows | OK |
| POST /portal/admin/workshops/:id/days | `createDay` (`days.ts:50`) | ~6 | n/a | row | OK (room advisory lock); does not take the workshop row lock — D-09 |
| PATCH /portal/admin/workshops/:id/days/:day_id | `updateDay` (`days.ts:83`) | ~8-12 | n/a | row | D-09, D-10 |
| DELETE /portal/admin/workshops/:id/days/:day_id | `deleteDay` (`days.ts:178`) | 4-5 | n/a | — | D-10 (check-then-delete with no lock) |
| GET /portal/admin/workshops/:id/tiers | `listTiers` (`workshops/tiers.ts:57`) | 3 | by workshop | — | OK |
| POST /portal/admin/workshops/:id/tiers | `createTier` (`tiers.ts:88`) | 4 | `day_ids` no max | — | OK |
| PATCH /portal/admin/workshops/:id/tiers/:tier_id | `updateTier` (`tiers.ts:133`) | 5-7 + `listTiers` (3) to return one tier (`tiers.ts:190-192`) | `day_ids` no max | — | P3 waste; D-09 |
| DELETE /portal/admin/workshops/:id/tiers/:tier_id | `deleteTier` (`tiers.ts:216`) | ~8 | n/a | — | OK — workshop row `FOR UPDATE` vs checkout's `FOR KEY SHARE` (`tiers.ts:203-214`) |
| GET /portal/admin/workshops/:id/promotions | `listManagedPromotionsFor` | 1-2 | by workshop | — | OK (service owned by packages slice) |
| PUT /portal/admin/workshops/:id/promotions | `replacePromotionsForParent` | per-promotion (packages slice) | `promotions` array no max | — | D-13 |
| GET /portal/admin/classpass | `readClassPassPage` (`classpass/settings.ts:183`) | ~12-14 sequential: INSERT…ON CONFLICT + SELECT settings, GROUP BY over all inbound emails, overbooked join, 3 setup aggregates, timezone, roster emails (text+html, 7 days), mappings, classes, bookings, emailed names | Aggregates scan the tenant's whole `classpass_inbound_emails` history twice; roster read bounded to 7 days | fine | D-11 |
| PATCH /portal/admin/classpass | `setClassPassEnabled` → `readClassPass` | 3 + ~8 | — | — | OK |
| POST /portal/admin/classpass/address/regenerate | `regenerateClassPassAddress` → `readClassPass` | 3 + ~8 | — | — | OK |
| GET /portal/admin/classpass/locations | `listClassPassLocationMappings` (`classpass/locations.ts:65`) | 1 | small table | — | OK |
| POST /portal/admin/classpass/locations | `addClassPassLocationMapping` (`locations.ts:92`) | 3 + rerun (1 locking read of ALL open booking emails incl. bodies + ~10-20 per matching email) + 1 | rerun unbounded | — | D-12 |
| PATCH /portal/admin/classpass/locations/:id | `changeClassPassLocationMapping` (`locations.ts:143`) | same shape | rerun unbounded | — | D-12 |
| DELETE /portal/admin/classpass/locations/:id | `removeClassPassLocationMapping` | 1 | — | — | OK |
| GET /portal/admin/classpass/review | `listClassPassReview` (`classpass/review.ts:65`) | 1 | NO limit; every open item | Full `text` AND `html` of every open email in the list (`review.ts:44-62`, `routes/portal/admin/classpass.ts:40-41`) | D-12 |
| POST /portal/admin/classpass/review/:id/book | `bookClassPassReviewItem` (`review.ts:115`) | 1 lock + place (~10-20) + 2 | — | one item incl. bodies | OK (`FOR UPDATE` on the item) |
| POST /portal/admin/classpass/review/:id/dismiss | `dismissClassPassReviewItem` | 3 | — | — | OK |
| POST /portal/admin/classpass/review/:id/location | `mapClassPassReviewLocation` (`review.ts:151`) | lock + mapping + rerun + re-read | rerun unbounded | every re-run item with bodies | D-12 |

### Inventory E: Super portal: tenants, transfer (export/import), maintenance, sign-in

| Method+Path | Service fn | Queries/call | Bounded? | Payload notes | Verdict |
|---|---|---|---|---|---|
| (gate) every `/api/v1/platform/*` | `requirePlatformAdmin` → `readPoolSession('platform')` | 1 session read, no tenant tx | n/a | – | OK |
| GET /platform/tenants | `listTenants` + `providerAccountStatuses` | 3 in parallel (tenants, `tenant_staff_counts()`, payment accounts) | Unpaginated by design (tens of studios) | narrow columns | OK |
| GET /platform/tenants/slug-check/:slug | `checkSlug`, `slugConflictFor` | 1-2 | yes | tiny | OK |
| POST /platform/tenants | `provisionTenant` | 1 tx: slug claim, tenant insert, settings, template + policy seed, staff invite; mail after commit | yes | – | OK |
| PATCH /platform/tenants/:id/status | `setTenantStatus`, `staffCountFor`, `providerAccountStatus` | 2 + 2 sequential | yes | – | OK (E-08 nit) |
| GET/PUT /platform/tenants/:id/business-details | `readBusinessDetails` / `saveBusinessDetails` in `withTenant` | 1 cached tenant read + 1 tx | yes | – | OK |
| PUT /platform/tenants/:id/term | `setTenantTerm` | 2 + 2 sequential | yes | – | OK |
| DELETE /platform/tenants/:id | `deleteTenant` | 1 tx: FOR UPDATE on tenant, 1 INSERT..SELECT of audit log, one DELETE per table (~75), then R2 purge after commit | Whole studio in one tx (studio must be suspended first) | counts only | OK - set-based |
| POST /platform/tenants/:id/slug | `renameTenant` | 1 tx, ~8 statements, FOR UPDATE | yes | – | OK |
| POST /platform/tenants/:id/admin | `inviteFirstAdmin` | 1 tx + mail after | yes | – | OK |
| PUT/DELETE /platform/tenants/:id/payment-credentials | `configureProviderAccount` / `releaseProviderAccount` | Stripe calls + 2-3 short `withTenant` writes; no tx held across Stripe | yes | never returns the key | OK |
| GET /platform/tenants/:id/export | `exportTenant` + `packArchive` | 1 REPEATABLE READ tx, one `SELECT *` per table (~75) | **No** - whole studio into JS memory, then JSON, then zip, then a copy | whole studio | **E-01, E-02** |
| POST /platform/tenants/:id/import | `importNow` → `restoreArchive` → `importTenant` | multipart fully buffered; 1 long tx: batch inserts + per-row loops | **No** (1 GiB cap only on the job route's announced size) | summary | **E-01, E-03, E-04, E-05** |
| GET /platform/imports | `openImports` | 1 + (BEGIN, set_config, UPDATE, SELECT, COMMIT) per tenant, sequential, incl. archived and e2e studios | grows linearly with tenants | job views | **E-06** |
| POST /platform/tenants/:id/imports | `startImport` | 1 tx, 3 statements | yes | – | OK |
| PUT /platform/tenants/:id/imports/:jobId/archive | `receiveArchive` → background `runImport` | upload buffered in memory; progress write every 500 ms, each its own tx | 1 GiB cap | – | **E-01, E-03, E-07** |
| GET /platform/tenants/:id/imports/latest | `latestImport` | 1 tx: UPDATE (expireStale) + SELECT | yes | – | OK (write on a polled GET, E-06) |
| POST /platform/tenants/:id/imports/:jobId/dismiss | `dismissImport` | 1 tx, 1-2 statements | yes | – | OK |
| GET/PUT /platform/maintenance | `readMaintenance` / `setMaintenance` | 1 / 2 | yes | – | OK |
| POST /platform/sign-in/step | `platformSignInStep` | 2 + optional mail | yes | – | OK |


## (c) Findings

IDs are prefixed by part (A-E). Each carries severity, CONFIRMED/SUSPECTED, file:line evidence, effect at 100 members + 10 admins, and a fix. Paths in parts A-D are relative to `be/src/`.

---

## Findings A: Attention, leave, staff, instructor payroll, policy, impersonation, small settings

### A-01 - The bell summary is ~31-41 statements, recomputed from scratch on every poll and every page navigation (P1, CONFIRMED count / SUSPECTED latency)

Evidence:
- `services/attention/index.ts:57-73`: `attentionSummary` runs `p.count(ctx, {})` for every applicable provider, then `p.count(ctx, { locationId })` again for every provider with a `badge`, then `unreadUpdateCount`. No cache, no ETag, no combined query.
- Registry has 23 providers (`services/attention/registry.ts:26-50`); all 23 apply to an admin.
- Statement count for an admin, no `location_id` (file:line of each count): locations 1 (`index.ts:31`); pt requests 1 (`pt-sessions/list.ts:669`); corporate x3 = 3 (`attention/corporate-requests.ts:67-72,111,136`); leave 2 (`leave/pending.ts:29-44`: an "is there only one admin" count, then the count); check-in 2 (`attention/check-in-unfinished.ts:71-76`); waitlist 2 (`attention/waitlist-seat-free.ts:30,54`: policy row, then count with two correlated subqueries per class); series ending 1 (`series-follow-ups.ts:61`); series kept 2 (`series-follow-ups.ts:104,140`); ClassPass review 1 (`classpass-review.ts:89`); ClassPass overbooked 1 (`classpass/settings.ts:206`); instructor pay missing 5 (`payroll/list.ts:297-320`, five multi-join count subqueries); part payment 1 (`billing/open-purchases.ts:572`); refunds 2 (`billing/refunds.ts:355`, the same grouped aggregate run once per kind, see A-03); workshop unrefunded 1 (`refunds.ts:596`); invitation expired 1, email change expired 1-2, staff without email 1 (`attention/staff-logins.ts:35,72-91,132`); members without email 1 and email bouncing 1 (`attention/email-delivery.ts:24,113`); term ending 0 (cached tenant row); payments configured 1 (`billing/provider-credentials.ts:173`); unread updates 1 (`attention/updates.ts:281`). Total ~31.
- With `location_id` (what the portal sends whenever a workspace is selected, `fe-portal/src/components/attention/attention-provider.tsx:90-93`): the 8 badge-carrying providers are counted a second time: +1 +3 +2 +2 +1 +1 = +10, total ~41.
- Poll cadence: `POLL_MS = 60_000` (`attention-provider.tsx:29`), plus on mount, on every `pathname` change (`:118-120`), on `visibilitychange` and on window `focus` (`:123-135`).

At 100 members + 10 admins: 10 admins idle = 10 calls/min = ~400 statements/min; admins actually working (a navigation every few seconds each, plus focus events) is more like 50-150 calls/min = 2,000-6,000 statements/min of pure badge refresh, each call holding 1 of the 10 pooled connections for the full run. Several of those statements grow with table history rather than with open work (A-03, A-04). Members booking compete for the same 10 connections.

Fix:
1. Cache the summary per `(tenantId, staffId or role, locationId)` for 15-30 s in process (the tenant row memo in `services/tenants/tenants.ts:65-87` is the existing pattern), and invalidate nothing: the bell tolerates 30 s.
2. Stop refetching on every route change; refetch on a mutation the page itself made, or debounce to at most once per 15 s client-side (cross-slice: fe-portal).
3. Collapse the cheap counts into one statement (`select (select count(*) ...) as a, (select count(*) ...) as b, ...`) so a summary is 3-5 round trips, not 31-41.
4. Add `Cache-Control: private, max-age=15` so a focus/visibility burst reuses the answer.

### A-02 - With a workspace selected, six count queries are run twice with identical SQL (P2, CONFIRMED)

Evidence: `services/attention/index.ts:64-68` recounts every badge provider with `{ locationId }`. Five of the eight badge providers ignore `scope` entirely: `corporateRequestPending`, `corporateSessionUnmarked`, `corporateRefundedStillScheduled` (`attention/corporate-requests.ts:67,111,136`, the count callbacks take only `ctx`), `leaveRequestPending` (`attention/leave-request-pending.ts:63`, 2 statements), `classpassReview` (`attention/classpass-review.ts:88`). 3 + 2 + 1 = 6 statements whose result is already in hand as `all`.

At target load: ~15% of every summary's statements are pure repeats.

Fix: add `locationBound: boolean` to `AttentionProvider` (`types.ts:93`) and only recount when it is true; or have `count` return `{ all, scoped }` from one statement using `count(*) filter (where location_id = $1)`.

### A-03 - Refund attention counts aggregate every Stripe payment the studio has ever taken, twice per summary and twice more per panel (P1, CONFIRMED shape / SUSPECTED cost)

Evidence: `services/billing/refunds.ts:310-352` (`refundCandidates`) groups ALL `stripe_payments` with status in (`succeeded`,`pending`,`refunded`) for the tenant by purchase, joined to `purchases` and `clients`, with no time bound, and filters in `HAVING`. `countRefundsNeedingAdmin` wraps it as a subquery (`:355-366`) and is called once for `incomplete` and once for `stale` (`attention/refunds.ts:57,71`). The panel's lists call `refundsNeedingAdmin` twice more, materialising every candidate row and then `.filter().slice()` in JS (`attention/refunds.ts:58-62,72-76`).

At target load: cost is linear in the studio's lifetime payment count (tens of thousands after a year or two), run on every admin poll. Needs `EXPLAIN ANALYZE` on a production-sized tenant to size, but nothing in the query can use an index to skip settled purchases.

Fix: drive from the small set, not the large one: `WHERE refund_requested_at IS NOT NULL OR status = 'refunded'` to pick candidate `purchase_id`s first (partial index on `stripe_payments (tenant_id, purchase_id) WHERE refund_requested_at IS NOT NULL`), then aggregate only those purchases. Compute `incomplete` and `stale` counts in one statement with two `count(*) filter (...)`. Same treatment for `countSilentPartPaidPurchases` (`billing/open-purchases.ts:572-584`), which is already narrowed by `status='open' AND part_paid_at IS NOT NULL` and is fine if that predicate is indexed (pool/index auditor).

### A-04 - Two polled counts are regex / expression scans with no usable index (P2, SUSPECTED)

Evidence:
- `members_without_email`: `btrim(email) ~* '\.invalid$'` over every non-deleted client of the tenant (`services/clients/manage.ts:55-60`, counted at `attention/email-delivery.ts:24`). A regex on an expression cannot use a btree; this is a scan of the studio's whole member table per poll.
- `email_bouncing`: `attention/email-delivery.ts:75-103`. A CTE unions all clients and all staff, joins `email_log` on `lower(btrim(p.email)) = lower(btrim(l.recipient_email))` over a 30-day window, then `DISTINCT ON` per recipient. Every poll sorts a month of the studio's email log.
- `staff_without_email` uses the same regex (`attention/staff-logins.ts:119-124`) but over a tiny table.

At target load: a studio with 5,000 members and ~30k emails/month pays a member-table scan and a 30k-row sort per admin per minute. Not dangerous alone; it is the largest fixed cost inside A-01.

Fix: store the fact instead of deriving it: a boolean/generated column `email_is_placeholder` on `clients` with a partial index `WHERE email_is_placeholder AND deleted_at IS NULL`; for bouncing, an index on `email_log (tenant_id, outcome_at)` plus restricting the scan to `status <> 'delivered'` first (find recipients with a bad outcome in the window, then check each one's latest) so the common case touches a handful of rows. Both are also covered by the A-01 cache.

### A-05 - The panel recounts everything the summary just counted, and five lists load all rows then slice in JS (P2, CONFIRMED)

Evidence:
- `attentionPanel` runs all provider counts again (`services/attention/index.ts:144-146`) before listing; opening the bell right after a poll repeats ~31 statements.
- Lists that ignore `limit` in SQL: `refundsNeedingAdmin(...).filter().slice(0, limit)` x2 (`attention/refunds.ts:58-62,72-76`); `listSilentPartPaidPurchases(...).slice(0, limit)` which also selects the whole `purchases` row and then runs `heldPaymentsFor` over every id (`attention/part-payment-silent.ts:43-44`, `billing/open-purchases.ts:586-609`); `listUnrefundedWorkshopPlaces` then JS sort + slice (`attention/refunds.ts:94-97`); `overbookedClassPassBookings` loads every overbooked booking with a `clients` join to build a per-class map (`attention/classpass-overbooked.ts:24-31`); `bouncing(ctx)).slice(0, limit)` (`attention/email-delivery.ts:131-132`).
- N+1 inside one list: `matchingClasses` runs one `count` per ambiguous ClassPass item in a `for` loop (`attention/classpass-review.ts:63-78`), up to `limit` (max 50) statements.
- `expiredEmailChanges` (1-2 statements) runs in both `count` and `list` (`attention/staff-logins.ts:99-103`); `instructor_pay_missing` runs its 5 statements in both (`attention/instructor-pay-missing.ts:41-44`); `waitlist_seat_free.list` reads the policy row twice (`attention/waitlist-seat-free.ts:58-60` and inside `filter`, `:30`).

At target load: the panel is opened by a person, not polled, so volume is low; the cost is latency (50-70 round trips) and memory proportional to open-item backlog rather than to the 5 rows shown.

Fix: let `list` return `{ items, total }` from one query (`count(*) over ()`), so the panel needs no separate count pass; push `ORDER BY ... LIMIT` into the five queries; replace the `matchingClasses` loop with one `GROUP BY (location_id, starts_at)` query over the distinct pairs.

### A-06 - GET /portal/admin/staff is an N+1 of ~7 statements per staff member, takes a row lock on every staff row and INSERTs, all in a read (P1, CONFIRMED)

Evidence:
- `services/auth/invitations.ts:567` -> `withLeaveFigures` -> `currentLeaveFigures` (`services/leave/requests.ts:337-357`), which loops `for (const id of [...staffUserIds].sort()) ... await figuresFor(...)`. The code says so itself: `// ponytail: one round trip per staff member. Batch the pool/request reads if the staff list ever gets long enough to notice.` (`requests.ts:351-352`).
- Per staff member (`leavePoolsFor`, `requests.ts:135-260`, then `yearRows`, `:290`): locked select of the staff row `.for('no key update')` (`:143-152`), policy row (`:158`, the same row re-read for every member), previous-year pools (`:169`), previous-year requests (`:186`, when pools exist), `INSERT ... ON CONFLICT DO NOTHING` into `leave_pools` (`:223`), re-read of stored pools (`:245`), this year's requests (`:292`). 6-7 statements.
- So a studio with 20 staff: 1 (staff) + 1 (policy) + ~140 + 1 (permissions) + 1 (invitations) + 1 (pending emails, `routes/portal/admin/staff.ts:205`) = ~145 statements for one page load, and the transaction holds `FOR NO KEY UPDATE` on all 20 `staff_users` rows until the response is sent.
- The same path runs for one row at the end of every PATCH (`services/auth/staff-archive.ts:440`).

At target load: the Staff page is one of the ten admins' regular pages; each load is ~150 round trips on one of 10 connections. The row locks serialise against anything that updates those staff rows (a leave submission's own `leavePoolsFor` lock, a profile save, an archive), so a slow Staff page load makes a concurrent leave submission wait. It does not block member bookings (`NO KEY UPDATE` does not conflict with the FK share locks bookings take), so P1 not P0.

Fix: batch. One query for all staff rows (already loaded at `invitations.ts:552`, pass them in instead of re-selecting each), one for `leave_pools WHERE staff_user_id = ANY($1) AND leave_year IN (y, y-1)`, one for `leave_requests WHERE staff_user_id = ANY($1) AND leave_year IN (y, y-1)`, read the policy once, compute in memory, and do the materialising INSERT as one multi-row `ON CONFLICT DO NOTHING` only for members whose current-year rows are missing. Take the per-person lock only when a row actually has to be written. Target: 5 statements regardless of staff count.

### A-07 - Instructor payroll returns the instructor's entire teaching history when no range is given, in six sequential multi-join queries, summed in JS (P2, CONFIRMED)

Evidence: `routes/portal/instructor/payroll.ts:21-25` makes `from` and `to` optional with no default and no span cap; `services/payroll/list.ts:324-390` runs six queries one after another (`await` each: main class, supporting class, main PT, supporting PT, workshops, manual), each a 4-5 table join with no LIMIT; `services/payroll/totals.ts:70-107` then groups, sums and sorts every row in JS and serialises every line.

At target load: an instructor with three years of classes pulls ~2,000-3,000 lines per page open. Modest alone, and it is per instructor, but it is unbounded growth on a screen that normally shows a month. (The admin Finance payroll read uses the same `listPayroll` with no forced instructor; that endpoint is another sub-slice's, noted here because the fix is shared.)

Fix: require `from`/`to` (default the current month in the route) and cap the span (e.g. 366 days) in zod; compute `total_sgd`, `session_count`, `unpriced_count` with SQL aggregates over a `UNION ALL` of the six sources; page the lines.

### A-08 - File uploads hold the request's database connection across an R2 PUT (P1, CONFIRMED)

Evidence:
- Leave document: `routes/portal/leave.ts:107-134` buffers up to 5 MB (`services/leave/rules.ts:632`) into memory, then `attachSupportingDocument` does a select, `await putObject(...)` (`services/leave/requests.ts:866`), a `FOR UPDATE` select and an update. All of it is inside the request's single transaction (`middleware/tenant.ts:102`), so the pooled connection is checked out, idle-in-transaction, for the whole upload. On the two refusal paths the transaction additionally holds the leave row's `FOR UPDATE` lock across an awaited R2 DELETE, which the code's own comment prices at "up to the 8 s storage deadline" (`requests.ts:868-887`).
- Profile picture: `services/profile-pictures/pictures.ts:53` `await putObject(...)` on the same terms (`routes/profile-picture.ts:30-37`), 5 MB (`pictures.ts:25`).
- `db/index.ts:52-58` documents this as a known price of the design.

At target load: each upload pins 1 of 10 connections for the duration of an outbound HTTPS PUT (hundreds of ms normally, seconds when R2 is slow). A handful of simultaneous uploads during a storage brown-out exhausts the pool and every member booking queues behind them.

Fix: do the bucket write before the tenant transaction opens (exempt the upload routes from the request-wide transaction and call `withTenant` only around the validate + update steps), or upload first to a pending key and commit the key in a short transaction. At minimum put a short timeout on `putObject` for these two callers.

### A-09 - Staff invitation / set-password / email-change mails are awaited inside the request transaction (P1, CONFIRMED)

Evidence: these services `await` the mail send inline rather than registering it with `afterCommit`: `services/catalog/instructors.ts:145` (`mailInvitation`, commented "Outside the transaction" but only outside the inner savepoint; the request transaction from `middleware/tenant.ts:102` is still open), `services/auth/invitations.ts:523` and `:693`, `services/auth/account-access.ts:89` and `:216`, `services/auth/staff-email-change.ts:329` and `:495`. The send path writes `email_log` then awaits the provider (`services/notifications/send.ts:231,250`). Leave's mails, by contrast, do use `afterCommit` (`services/leave/requests.ts:767,1254`), and `db/index.ts:85-107` explains why that is the intended pattern.

Consequences: (1) the connection is held across a Resend HTTPS call; (2) the invitation row and the `email_log` row are not yet committed when the mail leaves, so a later error in the request (the audit insert, for example) rolls back the invitation while the recipient already holds a link to it.

At target load: staff administration is rare, so volume is low; the exposure is the same pool-pinning as A-08 during a mail-provider slowdown, plus the correctness gap in (2).

Fix: move each of these sends to `afterCommit(() => ...)`. For `startStaffEmailChange`, which uses the send result to decide whether to keep the pending row (`staff-email-change.ts:329-339`), keep the row and surface delivery failure through the existing `email_log`/attention path instead.

### A-10 - Leave lists are unbounded (P2, CONFIRMED)

Evidence: `listLeaveRequestsForAdmin` has no LIMIT and `status=all` drops the only filter (`services/leave/requests.ts:958-981`, `routes/portal/admin/leave.ts:25-29,58-65`); each element is the whole `leave_requests` row plus applicant. `getOwnLeave` selects every request the person has ever filed regardless of the `year` asked for (`requests.ts:484-493`: the WHERE has no `leaveYear`), and the route serialises all of them (`routes/portal/leave.ts:74-78`).

At target load: small today (tens of staff x a few requests a year) so no immediate cost; it is a table that only grows and an endpoint with no ceiling.

Fix: cursor-page the admin list (`created_at, id`), default non-pending statuses to the current leave year; filter `getOwnLeave`'s request list to the requested year (balances already are).

### A-11 - Leave calendar accepts any date span (P3, CONFIRMED)

Evidence: `routes/portal/leave-calendar.ts:22-27` validates `from` and `to` as dates with no `to >= from` and no maximum span; `listLeaveCalendar` then loads every committed request overlapping the window with the whole row (`services/leave/requests.ts:1055-1074`) and computes peaks pairwise in JS.

Fix: refine `to >= from` and cap the span at ~100 days (the calendar shows a month).

### A-12 - GET /portal/leave and `year` (P3, CONFIRMED)

Evidence: `routes/portal/leave.ts:66` `year: z.coerce.number().int().optional()` has no range; `getOwnLeave` then runs `leavePoolsFor` for that year, which for any year <= the current one INSERTs `leave_pools` rows (`services/leave/requests.ts:221-234`). `?year=1900` materialises three rows for 1900; a loop over years fills the table.

Fix: `.min(2000).max(currentYear + 1)`; do not materialise years earlier than the staff member's `created_at` year.

### A-13 - Saving leave conflicts locks every instructor row of the studio (P3, CONFIRMED)

Evidence: `services/policy/update.ts:119-124` takes `FOR UPDATE` on all `instructors` rows (ordered, to avoid deadlock with leave submission) and then replaces the whole conflict set (`:129-131`). `FOR UPDATE` on `instructors` blocks concurrent leave submissions (which lock the same rows, `services/leave/requests.ts:605-617`) and any update of an instructor profile for the duration of the Settings save.

At target load: rare action, short hold. Noted because `FOR UPDATE` (rather than `FOR NO KEY UPDATE`) also conflicts with the `FOR KEY SHARE` an insert takes when it references `instructors` by foreign key, if any table does (pool/index auditor to confirm).

Fix: `FOR NO KEY UPDATE`, as the rest of the leave code uses.

### A-14 - No optimistic concurrency on staff-edited settings; two admins editing the same thing silently overwrite each other (P2, CONFIRMED)

Evidence: none of these writes carries or checks a version / `updated_at`: `updateStaffProfile` (`services/auth/staff-archive.ts:410-415`, plain UPDATE by id), `updateGlobalPolicy` (`services/policy/update.ts:107-111`; the `leave_conflicts` half is a delete-all + insert, `:129-131`, so admin B's stale list erases a pair admin A just added), `updateMarketing` (`services/marketing.ts:56`, whole document), `saveBusinessDetails` (`services/tenants/business-details.ts:173`), `adjustRemainingDays` (back-solves the pool from a Remaining the admin typed against figures that may have moved, `services/leave/requests.ts:407-440`; it is serialised by the staff row lock but not checked against what the admin saw).

At target load: 10 admins make simultaneous edits of the same settings page plausible. Scalar fields are last-write-wins per field (PATCH sends only changed keys), which is tolerable; the replace-the-set and whole-document writes lose data.

Fix: return `updated_at` (already serialised for policy, `routes/portal/admin/policy.ts:96`) and require it back as `If-Match` / `expected_updated_at`; `UPDATE ... WHERE updated_at = $expected`, 409 on zero rows. For leave conflicts, send add/remove deltas instead of the full set.

### A-15 - Feature-flag cache is process-local and written before the transaction commits (P3, CONFIRMED)

Evidence: `services/feature-flags.ts:50-65`: `cache.set(...)` runs inside the request transaction immediately after the upsert. If the request then fails (the audit INSERT in `middleware/audit.ts:79` runs after the handler, inside the same transaction), the row rolls back and the process keeps serving the uncommitted value until restart. The cache is also never refreshed from the database after boot (`loadFeatureFlags`, `:26-29`), so a second backend instance would never see the change.

At target load: single deployment, so only the rollback case is live. P3.

Fix: `afterCommit(() => cache.set(...))`; add a TTL reload if the backend is ever scaled out.

### A-16 - Missing zod bounds on staff-facing bodies (P3, CONFIRMED)

Evidence:
- `routes/portal/admin/staff.ts:80` `bio: z.string()` with no max; `:81-90` `languages` array has per-item max 60 but no array length cap.
- `routes/portal/admin/policy.ts:61-69` `leave_conflicts` array has no `.max()`; the service does O(n) set work and one multi-row INSERT of whatever arrives.
- `routes/portal/admin/instructors.ts:15` and `routes/portal/instructor/profile.ts:18-21`: `bio` / `phone` unbounded in zod; the service asserts bounds afterwards (`services/catalog/instructors.ts:100,156`), so this is a 400-shape inconsistency rather than a hole.
- `routes/portal/leave.ts:66` `year` (see A-12); `routes/portal/leave-calendar.ts:22-27` span (see A-11); `routes/portal/instructor/payroll.ts:21-25` range (see A-07).

Whatever the global JSON body limit is (server auditor's slice) is the only ceiling on the first two.

Fix: `bio.max(5000)`, `languages.max(20)`, `leave_conflicts.max(500)`.

### A-17 - Small redundancies (P3, CONFIRMED)

- `updateStaffProfile` re-reads the actor's staff row (`services/auth/staff-archive.ts:329-339`) that `staffAuth` loaded on this same request (`middleware/staff-auth.ts:66`); pass the role in.
- `leavePoolsFor` reads `global_policy` once per call (`services/leave/requests.ts:158`) and `currentLeaveFigures` reads it again first (`:342`); `listLeaveCalendar` and `flagsFor` each read the caps row and the full conflict-pair join separately (`requests.ts:1090-1118`, `leave/pending.ts:128-154`): the same two reads, duplicated code.
- `series_ended_class_kept` loads every dismissed subject id into JS and sends them back as a `NOT IN (...)` list (`attention/series-follow-ups.ts:104,111`) although `notDismissed` exists to do it as a correlated `NOT EXISTS` (`attention/dismissed-subjects.ts:11-18`) and the other two dismissable kinds use it. The list grows forever (dismissals are never pruned).
- `markUpdateRead` is select-then-update (`attention/updates.ts:339-345`); one `UPDATE ... RETURNING` with an existence fallback would do.
- `GET /portal/auth/me` selects whole location rows including archived ones and filters in JS (`routes/portal/auth.ts:24-27,38`).
- `PATCH /portal/admin/emails/:slug`: the service writes its own audit row (`services/notifications/switch-state.ts:80`) and the route does not set `auditFiled` (`routes/portal/admin/emails.ts:17-19`), so the `audit` middleware (`middleware/audit.ts:41`) writes a second one. SUSPECTED double audit row; confirm against the table.
- `attentionSummary` mutates `needsAction` / `byGroup` from inside `Promise.all` callbacks (`attention/index.ts:62-70`). Correct in single-threaded JS, and since all statements share one connection the `Promise.all` buys pipelining only.

---

## Findings B: Schedule, bookings, check-in, waitlist, catalog

### B-01 — The timetable has no required window and no range cap: one call can return a studio's whole history
- **Severity:** P1 · **CONFIRMED**
- **Evidence:** `routes/portal/timetable-read.ts:40-44` — `from` and `to` are both `.optional()`, with no maximum span. `services/schedule/timetable.ts:91-93` adds the time predicates only `if (opts.from)` / `if (opts.to)`; there is no `LIMIT` on any of the four kind queries (`:106-124`, `:192-209`, `:319-333`, `:424-442`). The same shape is used for the instructor mount (`timetable-read.ts:85-89`).
- **At 100 members + 10 admins:** a normal week view is fine. A List view opened on a wide range, a client bug that drops `from`/`to`, or a hand-made request loads every class, workshop day, PT session and corporate session the tenant has ever had, then issues `IN (…)` queries carrying thousands of ids for seats, waitlist and supporting instructors (`timetable.ts:126-143`). After a year a studio running 40 classes a week has ~2,000 class rows plus history imported from Mindbody. That is a multi-megabyte JSON response and several hundred milliseconds of one of the pool's connections, repeated by every admin whose calendar refetches.
- **Fix:** make `from` and `to` required in `windowQuery` and refuse a span over a cap (62 days covers a month grid with overflow). For the List view add keyset pagination (`starts_at`, `id`) with a page-size cap of 100–200 rather than a wider window.

### B-02 — The timetable issues 12 sequential queries per call and its window predicate cannot use the `starts_at` index for the lower bound
- **Severity:** P2 · queries **CONFIRMED**, index behaviour **SUSPECTED** (needs `EXPLAIN`)
- **Evidence:** every `await` in `listSchedule` is sequential (`timetable.ts:106, 127, 128, 132, 192, 213, 231, 259, 319, 336, 355, 424, 447`). The four kinds are independent of each other. The window is `ends_at >= from AND starts_at < to` (`timetable.ts:92-93`, `:188-189`, `:314-315`, `:411-412`), while the indexes are on `(tenant_id, starts_at)` (`db/schema/schedule.ts:103`, `:385`); `ends_at >= from` is then a filter over every row before `to`, so a week view reads the tenant's whole past from the index.
- **At target load:** the Schedule is the staff portal's landing surface; 10 admins and every instructor refetch it on each week change and after each write. 12 round trips ≈ 12–25 ms of connection time locally and more over a network hop to the database, all inside the request's single transaction. The lower-bound scan grows linearly with studio age.
- **Fix:** run the four kind blocks concurrently is not possible on one transaction connection (postgres.js pipelines but the statements still run serially), so reduce statement count instead: fold seat counts, waiting counts and supporting ids into the class query with lateral subqueries or `GROUP BY` joins, and do the same for workshops and PT (4 statements total). Add `starts_at >= from - interval '1 day'` (no session runs longer) alongside the `ends_at` predicate so the index bounds both ends.

### B-03 — Class Series preview and commit run roughly 750–1,100 sequential statements per request, twice per series
- **Severity:** P1 · **CONFIRMED** (the code's own comment says so, `services/schedule/series.ts:502-505`)
- **Evidence:** `withClashes` (`series.ts:506-523`) loops every occurrence and every subject and awaits `findClash` for each. `findOccupancyConflicts` issues 4 statements for a room (`services/schedule/occupancy.ts:249-339`) and 4 + 1 leave read (`:351-366`) + up to 2 per event kind with candidates (`:376-390`, `services/schedule/roster.ts:123-271`) for an instructor. The instructor branch does not filter by instructor in SQL: it loads every active event in the tenant overlapping the window, then reads their rosters (`occupancy.ts:373-375`). The commit repeats the whole scan (`series.ts:545`), then calls `replaceRoster` once per created class when there are supporting instructors (`series.ts:580-585`; 6 statements each: `roster.ts:303`, `:334`, `:402-420`). Range is capped at 366 days (`series.ts:64`), so N ≤ 53.
  - 53 weekly dates, main + 1 supporting: preview ≈ 4 + 53 × 14 ≈ **745**; commit ≈ 745 + 53 × 6 + ~15 ≈ **1,080**.
  - The commit holds `pg_advisory_xact_lock` on the room and every instructor for that whole time (`series.ts:143`, `occupancy.ts:469-479`), released only at the request's outer COMMIT.
- **At target load:** each preview or commit occupies one pooled connection for roughly 1–3 s (more with network latency to the database). Members booking are not blocked by the advisory locks (booking takes only the class row lock, `services/bookings/book.ts:299-319`), but any other admin or instructor creating or editing a session in the same room or for the same instructor waits behind it, and a few admins building next term's timetable at once take a meaningful share of the pool away from member requests. The preview is also re-run every time the form's dates change (fe-portal slice to confirm the trigger).
- **Fix:** batch the occupancy check. For one subject, fetch all candidate events between the first and last occurrence once (4 range queries with the room filter, or joined to the roster tables with the instructor filter in SQL), fetch the instructor's leave once, then test each occurrence in memory with the existing pure `occupies` / `leaveConflicts`. That makes preview and commit ~10–20 statements regardless of N. Replace the per-class `replaceRoster` loop with one multi-row insert into `class_supporting_instructors` (the instructors were already validated by `ensureInstructors` at `series.ts:144`).

### B-04 — Cancelling a class e-mails every booked member sequentially before the HTTP response returns
- **Severity:** P1 · **CONFIRMED**
- **Evidence:** `cancel-class.ts:241-242` registers the sends with `afterCommit`. `withTenant` awaits that work before returning (`db/index.ts:83`, and the doc comment at `:112-113`: "a request answers once its emails are handed over"). `sendClassCancelledByStudioEmails` loops `for (const n of notices) { await sendTemplatedEmail(...) }` (`services/notifications/send-booking-email.ts:278-297`); each send reads the template, the mail identity, inserts an `email_log` row and awaits the provider call (`services/notifications/send.ts:127-156`, `:231-250`). The waitlist notice is a second sequential loop (`send-booking-email.ts:301-…`). The same pattern applies to `sendPromotionEmails` (`services/waitlist/promote.ts:148-170`) and `sendRuleCancelledEmails` (`services/schedule/package-rule-change.ts:136-151`).
- **At target load:** a 30-seat class cancelled by an admin answers only after ~30 provider round trips (commonly 150–400 ms each): 5–12 s of spinner, likely past the proxy or browser timeout for a larger class, which invites a retry (the retry is safe: `class_not_active`, `cancel-class.ts:93`). The after-commit work holds a pooled connection for the duration of each provider call, because each piece runs inside its own `withTenant` transaction (`db/index.ts:134-144`). The data is correct; the cost is latency and connection time.
- **Fix:** hand mail to a queue instead of awaiting delivery in the request: insert `email_log` rows with status `queued` in the same transaction (the table and status already exist, `send.ts:231-241`) and let a worker or the existing cron drain them with bounded concurrency. Minimum change: do not await after-commit mail before responding, and send a batch with `Promise.allSettled` in chunks of 5–10 outside any database transaction.

### B-05 — Cancel-class writes 3+ statements per booking in a loop while holding the class row, all booking rows and all paying packages locked
- **Severity:** P2 · **CONFIRMED**
- **Evidence:** `cancel-class.ts:152-201`: per confirmed booking, `refundCredits` (ledger update + movement insert, `services/packages/ledger.ts`), `insert cancellations` (`:179-190`), `update bookings` (`:192-200`). The class row is locked at `:76-88`, every confirmed booking at `:143`, every paying package at `:144`.
- **At target load:** a 30-seat class is ~100–150 statements, tens of milliseconds. During that time any member booking or cancelling on that class, or spending one of the locked packages on another class, waits. Acceptable today; it scales with class size and is avoidable.
- **Fix:** one multi-row `insert into cancellations … values (…)`, one `update bookings … where id = any($1)` (two statements split by `refund_outcome`), and a set-based refund in the ledger (`update client_packages … from (values …)` + one multi-row movement insert).

### B-06 — Class detail reads each waiting member's packages one member at a time, inside a pointless savepoint
- **Severity:** P2 · **CONFIRMED**
- **Evidence:** `services/waitlist/staff.ts:77-102`: `db.transaction(async tx => { for (const e of line) { const pkgs = await candidatePackages(tx, tenantId, e.clientId) … } })`. Called from `getClassDetail` (`services/schedule/detail.ts:214-220`), which backs both the admin class page and the instructor roster. The savepoint wraps reads only.
- **At target load:** a popular class with a 15-person line costs 15 extra statements plus `SAVEPOINT`/`RELEASE` on every load of the session page, and that page is refetched after every roster action (add member, cancel, check-in tick). The rest of `getClassDetail` is 10 sequential statements (`detail.ts:108, 144, 149, 181, 211, 213, 214, 222, 264`).
- **Fix:** one query for all waiting members' active packages (`where client_id = any($1)`), grouped in memory; drop the `db.transaction` wrapper. Optionally return the waitlist pay status lazily (only when the panel is opened).

### B-07 — Ending a series cancels each unbooked class one at a time while every future class of the series is locked against member bookings
- **Severity:** P1 · **CONFIRMED**
- **Evidence:** `services/schedule/series.ts:372-384` locks every future active class of the series `FOR UPDATE`. `:404-406` then loops `cancelClassInTx` per unbooked class. Each call re-locks the row, updates it, reads the class subject and instructors, writes an Update for every instructor (`cancel-class.ts:116-125`), selects bookings `FOR UPDATE`, takes package locks, reads the policy, reads the line, and registers an after-commit e-mail job (`cancel-class.ts:241`) even though `notices` is empty. That job still opens its own transaction per class (`db/index.ts:134-144`).
- **At target load:** ending a year-long weekly series with ~50 unbooked classes is ~600–800 statements plus ~50 after-commit transactions, 1–3 s in total. For that whole time a member trying to book **any** of those future classes blocks on the class row lock (`book.ts:299-319`). Each instructor also receives up to 50 separate "cancelled" Updates in the bell.
- **Fix:** cancel the unbooked set with one `update classes set lifecycle='cancelled' … where id = any($1)`, one bulk waitlist removal, and one summary Update per instructor ("series ended from <date>, N classes cancelled"). Skip `afterCommit` when there are no notices.

### B-08 — No optimistic concurrency on class, series or catalog edits: two admins editing the same entity overwrite each other silently
- **Severity:** P2 · mechanism **CONFIRMED**; how much is lost depends on whether the portal sends the whole form (**SUSPECTED**, fe-portal slice)
- **Evidence:** `updateClass` serialises writers with `FOR UPDATE` (`services/schedule/classes.ts:210-215`) but applies whatever fields the patch carries (`:307-316`) with no version, `updated_at` or `If-Match` check; `updateClassSchema` has no such field (`routes/portal/admin/schedule.ts:36-59`). Catalog updates read then write with no lock at all (`services/catalog/locations.ts:72-73`, `rooms.ts:79-83`, `class-types.ts:125-139`).
- **At target load:** with 10 admins, two opening the same class (one changing capacity, one changing instructor) is plausible. If the form submits every field, the second save reverts the first with no warning. Invariants still hold (capacity floor and occupancy are re-checked under the lock), so this is lost work, not corruption.
- **Fix:** return `updated_at` (or a row version) with the class/series/catalog row, require it on PATCH, and answer `409 stale_edit` when it differs under the lock. Alternatively have the portal send only changed fields and document that as the contract.

### B-09 — A class edit can drop buffer or waitlist capacity below what is already used
- **Severity:** P3 · **CONFIRMED**
- **Evidence:** `services/schedule/classes.ts:249-254` checks only `capacityOnline` against `onlineUsed`. `capacityBuffer` and `capacityWaitlist` are written unchecked (`:314-315`), although `countSeats` already returns `bufferUsed`.
- **At target load:** a class can show "attending 14 of 12" or a line longer than its cap after an edit. Display inconsistency only; no booking is corrupted because `seatFor` recounts (`services/bookings/seats.ts:54-65`).
- **Fix:** refuse `capacity_buffer < bufferUsed` and `capacity_waitlist < waiting` the same way, or document that shrinking leaves existing holders in place.

### B-10 — Unbounded arrays and numbers in schedule bodies
- **Severity:** P2 · **CONFIRMED**
- **Evidence:** `excluded_dates: z.array(plainDate(...))` with no `.max()` (`routes/portal/class-series.ts:43`, `routes/portal/admin/schedule.ts:63`); `supporting_instructors` / `supporting_instructor_ids` arrays uncapped (`routes/portal/class-create.ts:138-139`, `class-series.ts:151`, `admin/schedule.ts:42-43`); `package_ids` uncapped (`routes/portal/class-package-rule.ts:15`); `capacity_online`, `capacity_waitlist`, `capacity_buffer`, `credit_cost` have `min(0)` and no maximum (`class-create.ts:77-80`, `class-series.ts:35-38`). Extend appends the caller's excluded dates to the stored array on every call (`services/schedule/series.ts:287`).
- **At target load:** not reachable by accident, but each supporting instructor multiplies the series scan (B-03) by 5 statements per date, so a body with 50 ids turns one preview into ~13,000 statements; an int above 2^31 becomes a 500 from Postgres instead of a 400.
- **Fix:** `.max(20)` on instructor arrays, `.max(366)` on `excluded_dates`, `.max(200)` on `package_ids`, `.max(1000)` on capacities and `.max(100)` on `credit_cost`.

### B-11 — Instructor member search is an unanchored `ILIKE` on three columns with a 1-character minimum, selecting the whole row
- **Severity:** P2 · query **CONFIRMED**; scan cost **SUSPECTED** (no trigram index found in `db/schema/identity.ts`; index auditor to confirm)
- **Evidence:** `routes/portal/instructor/roster.ts:30` (`q` min 1); `services/clients/manage.ts:224-236` — `%q%` over `name`, `email`, `phone`, `select()` of every client column, ordered by `lower(name)`, `LIMIT 10`. The route keeps three fields (`roster.ts:45`).
- **At target load:** a sequential scan and sort of the tenant's members per keystroke unless the portal debounces. A few thousand members is a few milliseconds; a studio imported with tens of thousands is not. The same function backs the admin search (other sub-slice).
- **Fix:** require 2 characters, select only `id, name, email`, add `pg_trgm` GIN indexes on `lower(name)`, `lower(email)` and `phone` (or prefix search with btree `text_pattern_ops`), and state a debounce contract for the client.

### B-12 — Check-in day: roster query ORs two columns, grouping is O(sessions × rows) in JS
- **Severity:** P3 · JS grouping **CONFIRMED**, plan **SUSPECTED**
- **Evidence:** `services/bookings/check-in.ts:522-525` — `or(inArray(bookings.classId, …), inArray(bookings.ptSessionId, …))`; `:530-532` — `rosterRows.filter(...)` once per session; `check_ins` is joined on `booking_id` alone (`:513`).
- **At target load:** a busy day is ~15 sessions × ~300 roster rows, trivial in JS. The OR may plan as a BitmapOr over `bookings_class_state_idx` and `bookings_pt_session_idx` (fine) or fall back to a tenant scan; worth one `EXPLAIN`. The desk view is the most likely polled staff page (fe-portal slice to confirm the interval).
- **Fix:** two queries (or `UNION ALL`) instead of the OR; group once into a `Map`.

### B-13 — Timetable waiting counts are computed by fetching every waiting row
- **Severity:** P3 · **CONFIRMED**
- **Evidence:** `services/waitlist/line.ts:55-59` loads id, class, client and joined-at for every live waiting entry of every class in the window and counts in JS; `services/schedule/timetable.ts:128` calls it for the whole timetable. Workshop instructor filtering is also done in JS after loading all days (`timetable.ts:279`).
- **Fix:** `select class_id, count(*) … group by class_id`; push the workshop instructor filter into SQL as the class and corporate branches already do (`timetable.ts:94-102`).

### B-14 — Catalog writes: read-then-write without a lock, and archive blockers return every row
- **Severity:** P3 · **CONFIRMED**
- **Evidence:** `services/catalog/rooms.ts:92-133` selects the id of every future class, workshop day and PT session in the room to decide whether to block the archive; `locations.ts:90-130` and `class-types.ts:150-175` do the same. None takes the occupancy advisory lock or a row lock, so a class created in the room between the check and the archive lands in an archived room (`assertRoomInLocation` reads without a lock too, `services/schedule/room-conflicts.ts:18-24`).
- **At target load:** rare (archiving is occasional), and the result is a scheduled class in an archived room, visible and fixable. The blocker reads are small today.
- **Fix:** `select 1 … limit 1` (or `count(*)`) for the blockers; take `lockOccupancy` for the room in `archiveRoom`, or lock the room row `FOR UPDATE` there and `FOR SHARE` in `assertRoomInLocation`.

### B-15 — Create and patch re-read what they just wrote to build the response
- **Severity:** P3 · **CONFIRMED**
- **Evidence:** `routes/portal/class-create.ts:16` (`listSupportingInstructors` → 2 statements via `readRosters`) and `:37` (`classPackageRuleJson`) run after `createClass` / `updateClass`, which already hold the roster and the rule; `updateClass` itself re-selects the row after the roster write (`services/schedule/classes.ts:334-339`) and reads the instructors twice (`:319`, `:351`). `createSeries` / `extendSeries` / `setSeriesRule` finish with a fresh `getSeries` (`series.ts:203, 269, 434`).
- **Fix:** return the roster and rule from the service result; low priority.

### B-16 — Instructor roster read builds the full class detail before checking ownership
- **Severity:** P3 · **CONFIRMED**
- **Evidence:** `services/schedule/detail.ts:328-331` — `getClassDetail` (10+ statements, B-06) runs first, then `mainInstructorId !== instructorStaffId` → 403. Same for PT (`:376-379`).
- **At target load:** no data leaks (the 403 carries nothing), but a request for someone else's class costs the full read. Also note the instructor timetable lists classes the caller only supports (`timetable.ts:94-102`), yet opening one of those is refused here, so the UI will hit this 403 path routinely.
- **Fix:** check ownership from a one-row read first.

### Cross-slice notes (not findings of this part)
- `postgres(url)` is created with no `max` (`db/index.ts:27`), so the driver default applies; every finding above that holds a connection for seconds (B-03, B-04, B-07) should be read against that pool size. Pool auditor.
- Whether the Schedule, check-in desk and class page are polled, and how often the series preview fires, is fe-portal's to confirm.
- `searchClients` is shared with the admin clients surface (other sub-slice).

---

## Findings C: Clients, finance, purchases, receipts, package catalogue, promo codes, merch

### C-01 (P1, CONFIRMED) Manual credit adjustment is an unlocked read-modify-write and loses a concurrent booking's debit
Evidence: `services/packages/adjust.ts:83-109`. `adjustBalance` reads the package through `editablePackage` (adjust.ts:39-49, a plain SELECT), computes `next = pkg.creditsOrSessionsRemaining + input.delta` in JS (adjust.ts:87) and writes the absolute value (adjust.ts:106-109). Every other writer of that column goes through the ledger's `move`, which takes the row `FOR UPDATE` before reading (`services/packages/ledger.ts:107-123`). `setPackageExpiry` in the same file does lock first (adjust.ts:435-439), so the omission here is an oversight, not a design choice. `setBalance` is worse: it reads the balance outside any savepoint, derives the delta from that read (adjust.ts:144-148), then `adjustBalance` reads again.
What happens at target load: a member books a class (debit holds the row lock until their request commits) while an admin tops up the same package. Admin's SELECT sees 5 (the debit is uncommitted), admin's UPDATE waits on the lock, the booking commits 4, the admin writes 5+2=7. The member has a booking and still has the credit: a free class. The `credit_movements` row then records `balance_after` 7 against a chain that should read 6, so the member-visible history stops adding up. Two admins adjusting the same package concurrently lose one of the two deltas the same way. With "Set balance" the stale delta also defeats the admin's intent (they typed an absolute number and get something else).
Fix: in `adjustBalance`, take `SELECT ... FOR UPDATE` on the package row before `editablePackage` (as adjust.ts:435-439 does), or better, route the write through `ledger.move` (`refundCredits`/`debitCredits` with cause `adjusted`) so there is one read-modify-write for the column. Make `setBalance` compute its delta inside that same locked section. Add a concurrency test alongside the existing booking race tests.

### C-02 (P1, CONFIRMED) Finance list, overview and CSV export read the studio's whole ledger with no pagination and no date bound
Evidence: `routes/portal/admin/finance.ts:44-58` makes `from` and `to` optional with no maximum span and there is no `page`/`limit`. `getFinance` (`services/finance/list.ts:570-619`) runs up to 17 statements one after another: six payroll arms (`services/payroll/list.ts:330-378`, each a 3-5 table join; the workshop arm is a GROUP BY/HAVING over every workshop, payroll/list.ts:247-289) and eleven money-in reads (list.ts:138, 168, 206, 235, 252, 307, 318, 328, and `paymentMethods` at list.ts:493 and 516). Three of those ignore the date window by design and read the tenant's entire history on every call: all refunded payments (list.ts:328-334), all migrated-refunded purchase ids (list.ts:318), and every succeeded or refunded payment plus every offline purchase (list.ts:493-519). The code says so itself ("ponytail: read over the studio's whole history", list.ts:486-490). Location, type, name search, method and needs-pay filters are all applied in JS after the union (list.ts:586-617); totals are summed in JS and all rows are sorted and serialised (`services/finance/totals.ts:176-248`). `/export` builds the whole CSV as one string (`services/finance/csv.ts:48-69`).
What happens at target load: for an imported studio (the clients route comment at clients.ts:79 says the first studio arrived with thousands of members) an "All time" view is tens of thousands of rows materialised three times in Node (driver rows, MoneyEvent objects, serialised rows) and a multi-megabyte JSON body, while one of ten pooled connections is held for the full sequence. Two or three admins on Finance at once take a third of the pool for seconds, and members' booking requests queue behind them. JSON serialisation and the JS sort run on the event loop, stalling every other request on the single backend process. Cost grows with the studio's lifetime, not with the period selected, because of the three whole-history reads.
Fix: (1) require `from` and `to` on the list and export and cap the span (for example 366 days) in zod; (2) paginate the row list server-side (keyset on `occurred_at, id`) and compute the five tiles and per-instructor totals with SQL `SUM`/`COUNT` per source rather than from materialised rows; (3) push location/type/method filters into each source's WHERE; (4) replace the whole-history reads with lookups keyed on the ids already returned for the window (`inArray(stripePayments.purchaseId, ...)`), which the code comment already names as the next step; (5) stream the CSV (a cursor over the same paged read) and run the export under `REPEATABLE READ` so the file is one snapshot; (6) run the independent source reads on the request's connection in fewer statements (a `UNION ALL` per side).

### C-03 (P1, SUSPECTED: needs EXPLAIN on production-sized data) Member and receipt search is a leading-wildcard ILIKE over three columns with no trigram index and no minimum length
Evidence: `services/clients/manage.ts:140-144` (`%term%` over `name`, `email`, `phone`), repeated in `searchClients` (manage.ts:223-237) and `services/receipts/read.ts:124-128` (`display_number`, `buyer_name`, `buyer_email`). The only relevant index is btree `clients_name_lower_idx` on `(tenant_id, lower(name))` (`db/schema/identity.ts:71`), which a leading wildcard cannot use; there is no `pg_trgm` extension or GIN index anywhere in `db/migrations`. `q` has a max of 200 but no min (routes/portal/admin/clients.ts:85; receipts.ts:34), so a one-character term is accepted. Each search request runs the predicate twice: once for `count(*)` and once for the page (manage.ts:152-161; read.ts:137-144).
What happens at target load: every keystroke from each of 10 admins is two sequential scans of that tenant's members (or receipts) with three ILIKE evaluations per row. At a few thousand members that is tens of milliseconds each, tolerable alone, but it is the most frequent staff query and it scales linearly with the member table; the debounce contract is entirely the frontend's (cross-slice: fe-portal).
Fix: `CREATE EXTENSION pg_trgm` and GIN trigram indexes on `clients (name, email, phone)` and `receipts (display_number, buyer_name, buyer_email)`; require `q.length >= 2` in zod; when `q` is present, skip the exact `count(*)` or cap it (`LIMIT 1001` subquery) so a search costs one scan.

### C-04 (P1, CONFIRMED) The Finance overview runs the full ledger read to return a handful of aggregates, and the Finance page pays for it twice
Evidence: `services/finance/overview.ts:262-268` calls `getFinance(tenantId, period)` and uses only `totals`, `unpriced_count`, `instructor_totals` and a regroup of `rows` (overview.ts:270-278); the rows are serialised and sorted (`finance/totals.ts:236-238`) and then discarded. It then adds two `bookings` aggregates joined to `classes` (overview.ts:154-164, once for the period and once for the previous window), a `count(distinct)` over all active packages (overview.ts:227-242), a clients count and a purchases sum. `GET /finance` and `GET /finance/overview` are separate endpoints with separate periods (finance.ts:114-125), so a page showing both runs `getFinance` twice.
What happens at target load: everything in C-02, doubled, for the screen an owner opens most. With no `from` the attendance aggregate scans every attended booking the tenant has ever had.
Fix: give the overview its own SQL aggregates (`SUM(list_price)`, `SUM(paid)`, `COUNT(*)` grouped by category per source) rather than going through the row list; or have the list endpoint return the overview block when asked so one read serves both. Bound the period as in C-02.

### C-05 (P1, CONFIRMED) Payment-provider calls are made inside the request transaction, one per payment, holding a pooled connection and row locks
Evidence: `returnEveryPayment` loops `refundAtProvider` then `stampRefundRequested` per payment, sequentially (`services/billing/refunds.ts:862-876`); the Stripe call is `refunds.create` (refunds.ts:789-796). It is reached from `issueRefund` (refunds.ts:481), `issueWorkshopRefund` (refunds.ts:729) and `issueOpenPurchaseRefund`, which first takes `purchases ... FOR UPDATE` (refunds.ts:990-995) and may call `checkout.sessions.expire` and `retrieve` (refunds.ts:1102-1113) before the refunds, all with that lock held. `changeClientEmail` calls `customers.update` per provider customer (`services/clients/change-email.ts:117`, `services/billing/payment-customers.ts:396-400`); `deleteMemberPermanently` calls `customers.del` per customer (`services/clients/member-delete.ts:68`, payment-customers.ts:453-460). `db/index.ts:50-56` acknowledges the cost ("a request holds a pooled connection for its whole life, including any Stripe or mail call inside it").
What happens at target load: a refund of a part-paid purchase with three payments is three Stripe round trips (typically 300 ms to 2 s each, up to the `outbound` deadline when Stripe is slow) with one of ten connections pinned. During a Stripe slowdown, a few admins issuing refunds can pin several connections for the length of the deadline while members' bookings wait for a connection. For the open-purchase path the `purchases` row lock is also held, so the member's own resume-checkout request (`lockPurchase`, `services/billing/open-purchases.ts:249-255`) and the Stripe webhook for that purchase block behind it for the same time. Correctness is protected (idempotency key `refund:<intent>`, refunds.ts:794), so this is latency and pool pressure, not double refunds.
Fix: split the refund into "decide and record intent" (short transaction: lock, validate, stamp `refund_requested_at`, audit row) and "ask the provider" run after commit (`afterCommit`, or a small outbox the webhook path already tolerates, since the unwind is driven by `charge.refunded`). Do the same for the customer email sync and customer deletion, which already tolerate provider failure. Separately, raise and make explicit the pool size and add `lock_timeout`/`statement_timeout` (pool auditor).

### C-06 (P2, CONFIRMED) Mail, object-store and logo HTTP calls run inline inside the request transaction on staff write paths
Evidence: `createClient` awaits `sendTemplatedEmail` directly (`services/clients/manage.ts:372-383`), which reads the template, inserts the log row and calls the mail provider (`services/notifications/send.ts:119-121`, deliver at send.ts:231-250) rather than registering through `afterCommit` as `db/index.ts:55-56` says mail does. `resendReceipt` does the same after rendering a PDF (`services/receipts/resend.ts:38-39`). `sendMemberSetPasswordLink` mails inline (`services/auth/account-access.ts:89`). `receiptPdf` fetches the studio logo over HTTP on every PDF with no cache (`services/receipts/pdf.ts:28-29`, `services/receipts/logo.ts:36-48`) and renders with pdfkit on the event loop. `setMerchImage` uploads up to the image limit to R2 before its UPDATE (`services/catalog/merch.ts:119`).
What happens at target load: each of these pins a pooled connection for the length of a third-party call. An admin importing or adding members by hand, or re-sending a batch of receipts, holds a connection per click for the mail provider's response time. PDF rendering blocks the event loop for every other request while it runs.
Fix: move the invite and receipt-resend mail to `afterCommit` (the function already exists and is the documented convention); cache the fetched logo bytes per tenant and logo URL with a short TTL; upload to R2 before opening the write, or accept a presigned upload and only record the key in the request.

### C-07 (P2, CONFIRMED) Receipts CSV export has no row cap and no required date range, and loads whole rows
Evidence: `exportStudioReceipts` runs `db.select().from(receipts)` with the list's filters and no LIMIT (`services/receipts/read.ts:179-183`); `from`/`to` are optional (`routes/receipt-views.ts:25-27`, receipts.ts:40). The select pulls every column including the `lines`, `payments` and `bill_to` JSONB snapshots and the five seller text fields (`db/schema/ledger.ts:492-519`) to emit a summary CSV, built as one string (`services/receipts/csv.ts`).
What happens at target load: with no filter this is every receipt the studio has issued, with its JSON snapshots, in memory at once; several megabytes for a long-lived studio, on a held connection. Less severe than C-02 because it is one query, but it grows without bound.
Fix: select only the columns the CSV writes; require a date range or cap the span; stream the response from a cursor.

### C-08 (P2, CONFIRMED) Member detail issues roughly 25 statements and repeats several identical reads
Evidence: the route fans out ten service calls (`routes/portal/admin/clients.ts:470-493`). `readBookings` is called three times (upcoming, past, cancelled) and each call re-reads the cancellation policy (`services/bookings/member-history.ts:352`, `services/policy/evaluate-cancellation.ts:60`, not cached), so the same settings row is read three times per page. `heldPaymentsFor` and `promoCodesFor` run once inside `refundStatesFor` (`services/billing/refunds.ts:192-197`), again inside `listWorkshopPurchases` (refunds.ts:694-697) and `heldPaymentsFor` a third time inside `listOpenPurchases` (`services/billing/open-purchases.ts:151-154`). `listClientPackages` (6-way join, `services/packages/entitlements.ts:284-323`) and `refundStatesFor` (5-way join with GROUP BY, refunds.ts:162-188) both walk the member's packages. `memberAttendanceSummary` aggregates every booking the member ever had (member-history.ts:406-417). Because the request is one connection, the `Promise.all` at clients.ts:482 does not shorten any of this.
What happens at target load: each open of a member profile is ~25 round trips on one connection, about 30-80 ms of database time on a local network and more against a remote database; ten admins working through members is the steady background load on the pool. Not a failure, but it is the heaviest ordinary staff read and the page refetches it after every edit (the edit responses say so, clients.ts:411-413).
Fix: read the cancellation policy once in the route and pass it down; compute held payments and promo codes once for the union of purchase ids; fold the three `readBookings` scopes into one query with a scope column (or lazy-load past and cancelled tabs behind their own endpoints with pagination); consider splitting the payload so an edit refetches only the packages block.

### C-09 (P2, CONFIRMED) The trial funnel is recomputed over every matching member on each page of the Trials filter
Evidence: `services/clients/manage.ts:181-192`. With `filter=trials` every request, including each page turn and each search keystroke, runs a `count(*) filter (...)` with two correlated subqueries per trial member (`trialAttendedCount` joins `client_packages` to `bookings`, manage.ts:105-112; `hasConverted`, manage.ts:113-120) across the whole filtered set, in addition to the same subqueries for the page's rows (manage.ts:166-177). `hasTrial` and the `trialStartedAt` subquery omit `tenant_id` (manage.ts:101-104, 169-172), unlike the two beside them whose comment says the tenant is named so the `(tenant_id, client_id, ...)` index is used (manage.ts:98-100).
What happens at target load: for a studio with a few thousand imported trial members, paging the Trials list costs thousands of correlated lookups per click. Bounded by the tenant, but it is work repeated for a figure that does not change between pages.
Fix: return the funnel only on page 1 (or from its own endpoint the page calls once per filter), or compute it with one grouped join instead of per-row subqueries; add `cp.tenant_id = ...` to `hasTrial` and the `trialStartedAt` subquery.

### C-10 (P2, CONFIRMED) CSV exports do not neutralise spreadsheet formulas
Evidence: `services/finance/csv.ts:43-47` and `services/receipts/csv.ts:50` quote only `"`, `,` and newlines. The exported cells include member-controlled text: the member's name (`user`, `buyer_name`), email, and the manual-entry label.
What happens: a member who sets their name to `=HYPERLINK(...)` or `+cmd|...` gets it evaluated when the bookkeeper opens the file in Excel or Sheets. Independent of load.
Fix: prefix any cell beginning with `=`, `+`, `-`, `@`, tab or carriage return with a single quote (or a leading space) in both `cell` helpers; share one helper.

### C-11 (P2, CONFIRMED) Staff edits to shared entities are last-write-wins with no optimistic concurrency
Evidence: `updateClassPackage` reads the row, validates the merge in JS and writes without a version predicate (`services/packages/class-packages.ts:136-159`); `updatePtPackage` (pt-packages.ts:117-118), `updateCorporatePackage` (corporate-packages.ts:77-87), `updatePromoCode` (promo-code-admin.ts:319-372), `editClientProfile` (`services/clients/edit-profile.ts:40-53`), `setBoundInstructor`, `setCrossLocationAddOn` and `setHomeLocation` (`services/packages/adjust.ts:330, 182, 235`, none takes the row lock that `setPackageExpiry` takes) follow the same pattern. `replacePromotionsForParent` reads the existing promotions, then archives and upserts one statement per item (`services/packages/promotions.ts:160-217`); two admins saving the same package's promotions interleave and can each insert their "new" promotions, leaving duplicates. No table in the slice carries a version column and no route accepts `If-Match` or an `updated_at` precondition.
What happens at target load: with 10 admins, two editing the same package, promo code or member silently overwrite each other; for a price or a promotion that is a money-facing mistake nobody is told about. `updateClassPackage` validating kind fields against a stale read can also write a combination the validator would have refused. Members buying concurrently are safe (purchases freeze the price they were quoted), so this is admin-versus-admin only.
Fix: add `updated_at` (already present on most rows) as a precondition: the client sends the value it loaded, the UPDATE adds `AND updated_at = $sent`, and zero rows returns 409. For `replacePromotionsForParent`, lock the parent row `FOR UPDATE` first. Give the three `adjust.ts` setters the same lock `setPackageExpiry` uses.

### C-12 (P3, CONFIRMED) Missing zod bounds and small over-fetches
- `promotionsField` is an uncapped array (`routes/portal/admin/package-fields.ts:62`), and each element becomes its own UPDATE or INSERT (`services/packages/promotions.ts:193-217`). Cap at a sane number (for example 20).
- Promo code `products` arrays are uncapped (`routes/portal/admin/promo-codes.ts:44, 55`). Cap them.
- Finance `q` has no max length (`routes/portal/admin/finance.ts:50`); manual entry `label` has no max (finance.ts:82).
- `page` accepts up to 100000 on clients and receipts (clients.ts:92; receipt-views.ts:28) with OFFSET paging (manage.ts:160; read.ts:143): a deep page is a full scan and discard. Use keyset paging or reject offsets beyond the count.
- `receiptsPage` selects whole receipt rows, including JSONB snapshots, to return a six-field summary (`services/receipts/read.ts:137-139`). Select the summary columns.
- `listSilentPartPaidPurchases` selects the whole `purchases` row (open-purchases.ts:592) including `metadata`.
- `listPromoCodes` attaches scope and counts with `filter`/`find` per code (promo-code-admin.ts:157-161): quadratic in JS; build maps.
- The clients list sorts by `joined_at` (manage.ts:150) with no `(tenant_id, joined_at)` index (`db/schema/identity.ts:63-72`); Finance filters `client_packages.purchased_at`, `stripe_payments.created_at/refunded_at/status`, `merch_orders.created_at` and `receipts.issued_at` by tenant and date with no matching `(tenant_id, <date>)` index (`db/schema/packages.ts:423-431`, `db/schema/ledger.ts:369-384, 530-535`). SUSPECTED, for the index auditor to confirm with EXPLAIN.

### C-13 (P3, CONFIRMED) "Reported, not thrown" error handling does not hold inside the request transaction
Evidence: `refundPurchaseAndAudit` and `issueOpenPurchaseRefund` wrap the audit insert in try/catch so a failed insert is reported and the admin is still told the refund went through (`services/billing/refunds.ts:935-960, 1026-1030`). `forgetProviderCustomers` catches its own DB read (`services/billing/payment-customers.ts:437-444`) and the caller's comment says it "never throws, including on its own read" (`services/clients/member-delete.ts:64-66`). Both run on the request's transaction: a failed statement aborts that transaction in Postgres, and `db/index.ts:219-224` notes the driver rethrows a failed statement when its scope ends. The catch therefore hides the error from the service but the request still fails and rolls back, including the `refund_requested_at` stamps written for payments Stripe has already refunded.
What happens: rare (it needs a DB error at exactly that point), and the `charge.refunded` webhook plus the idempotency key repair the state. But the stated guarantee is not what the code delivers, and the admin sees a 500 for a refund that happened.
Fix: put each of those "must not fail the request" statements in its own savepoint (`db.transaction`) so a failure rolls back only itself, or write them via `afterCommit`.

### C-14 (P3, CONFIRMED) Member export is not a consistent snapshot and builds the archive in memory
Evidence: `exportMember` reads each member table in its own statement at READ COMMITTED (`services/clients/member-export.ts:36-42`), whereas the studio export uses `withTenant(..., { isolation: 'repeatable read' })` for exactly this reason (`db/index.ts:68-78`). `packArchive` builds the zip in memory with JSZip (`services/tenants/transfer-archive.ts`).
What happens: a member booking while an admin exports their data can produce an archive whose bookings reference a row another table's read did not include. Size is one member's rows, so memory is not a concern. An access-request export should be self-consistent.
Fix: run the export under repeatable read (a dedicated `withTenant` for this route), as the studio export does.

### C-15 (P3, SUSPECTED) Creating a member is check-then-insert on the email
Evidence: `createClient` checks for an existing row (`services/clients/manage.ts:343-352`) and then inserts (manage.ts:354-369); the unique constraint `clients_tenant_email_unique` (`db/schema/identity.ts:67`) is the real guard, and no unique-violation mapping is visible in this function.
What happens: two admins adding the same person at once, or an admin adding someone who is self-registering at that moment, gets a constraint error that likely surfaces as a 500 rather than the 409 `email_in_use` the check returns. Needs a test to confirm what the error boundary maps it to.
Fix: catch the unique violation (the repo has `db/unique-violation.ts`) and return the same 409.

---

## Findings D: PT sessions, corporate, workshops, ClassPass

### D-01 — P1 — CONFIRMED — Admin PT queue returns the whole history with no limit
Evidence: `routes/portal/pt-request-routes.ts:254-263` accepts `status` of `scheduled | cancelled_* | attended | all` and nothing else; `services/pt-sessions/list.ts:661-665` applies a limit only when the caller passes one, and the route never does. Each call then runs `hydrateAdminRows` (`list.ts:506-617`), whose three `inArray(...)` reads take every returned id as a bind parameter (`list.ts:519, 530, 550`), and `sessionlessReturns`.
At target load: a studio with a year of PT has thousands of `attended` rows; the Admin's PT page on "All"/"Attended" pulls all of them plus all their slots and every booking on every session into Node, on a pooled connection held for the whole request. 10 admins doing this while 100 members book occupies connections for seconds each and the response grows without bound (postgres.js also has a 65 534 bind-parameter ceiling, which `inArray` over all ids will eventually hit and turn into a 500).
Fix: add `limit` (default 50, max 200) and a keyset cursor on `(created_at, id)` to the query schema and to `listPtRequestsForAdmin`; the index `pt_requests_status_created_idx (tenant_id, status, created_at)` already serves it. Return `next_cursor`. For history statuses also accept a `from`/`to` range.

### D-02 — P1 — CONFIRMED — Workshop cancel sends one email per attendee serially, inside a database transaction, before the response
Evidence: `services/workshops/cancel.ts:106` registers `sendWorkshopCancelledEmails` via `afterCommit`; `db/index.ts:128-137` runs after-commit work inside a fresh `withTenant` (an open transaction on a pooled connection) and `withTenant` awaits it before returning (`db/index.ts:84`); `services/notifications/send-booking-email.ts:527-547` loops the bookings and awaits `sendTemplatedEmail` one at a time, each of which does a template read, an identity read, a log insert, the provider HTTP call and a log update (`services/notifications/send.ts:120-156, 231-264`).
At target load: cancelling a 40-seat workshop holds one pooled connection idle-in-transaction for 40 sequential provider round trips (tens of seconds), and the Admin's request does not answer until they finish; a proxy timeout makes the Admin retry (the retry is refused `workshop_already_cancelled`, so no double send, but the UI shows a failure for a cancel that succeeded). With the pool at the postgres.js default (`db/index.ts:27`, no `max`), one such cancel is 10% of the pool. The same shape applies to PT cancel mail (`pt-sessions/cancel.ts:122-126`) but that is at most 2-3 mails.
Fix: move fan-out mail to an outbox table written in the cancel's transaction and drained by a worker (bounded concurrency, no open transaction across the provider call); at minimum, do the DB reads/writes in short transactions and make the provider call outside any transaction, and answer the request without awaiting delivery.

### D-03 — P2 — CONFIRMED — Corporate session and request lists are unbounded
Evidence: `routes/portal/admin/corporate-sessions.ts:11-15` makes `from`/`to` optional with no cap on the span; `services/corporate/sessions.ts:185-199` returns `select()` whole rows with no limit. `routes/portal/admin/corporate-requests.ts:15-17` + `services/corporate/requests.ts:235-248`: `status=all` (or `attended`/`cancelled`) returns everything.
At target load: low volume today (corporate is rare), so cost is small; it is an unbounded endpoint that grows forever.
Fix: require `from`+`to` (cap 92 days) on sessions; add `limit`/cursor on requests using `corporate_requests_status_created_idx`.

### D-04 — P1 — CONFIRMED — Two admins scheduling the same corporate request both succeed, leaving an orphan session
Evidence: `services/corporate/requests.ts:310-321` reads the request and checks `status === 'pending'` with no lock; `createCorporateSession` (`requests.ts:330`) inserts a session; the link (`requests.ts:348-364`) is an unconditional UPDATE with no `status = 'pending'` predicate. Under READ COMMITTED both requests pass the check; the occupancy advisory locks (`schedule/occupancy.ts:496`) only stop them if they chose the same room or an overlapping instructor at overlapping times. Otherwise two `corporate_sessions` rows exist, the request points at the second, and the first stays `active` on the calendar with `corporate_request_id` set, occupying a room and instructor. Compare the PT path, which re-reads under `FOR UPDATE` for exactly this reason (`pt-sessions/schedule.ts:156-165`).
At target load: needs two admins on the same request within the same second or so (double-click with a slow response qualifies: the route has no idempotency). Rare but silently corrupting.
Fix: open the savepoint first, `SELECT … FOR UPDATE` the request, re-check `pending`, then create the session and link, all inside it; make the final UPDATE conditional on `status = 'pending'` and treat zero rows as `not_pending`.

### D-05 — P2 — CONFIRMED — Corporate session edit validates against an unlocked read and never checks lifecycle
Evidence: `services/corporate/sessions.ts:258-263` reads `existing` outside the savepoint and without `FOR UPDATE`; the composed state (`:266-276`) and the time-range check (`:279`) use that snapshot; the UPDATE writes only patched columns (`:334-349`). There is no `existing.lifecycle` check anywhere in the function, so a cancelled session can be rescheduled (and its roster replaced, notifying instructors).
What happens: admin A moves the start later while admin B moves the end earlier; each passes `ends > starts` against the old row, and the saved row can end before it starts. A cancel racing an edit leaves an edited, cancelled session.
Fix: lock the row `FOR UPDATE` inside the savepoint, compose and validate from the locked row, refuse `lifecycle !== 'active'` with 409.

### D-06 — P3 — CONFIRMED — Corporate request cancel / attended are read-then-write with no guard
Evidence: `services/corporate/requests.ts:382-399` and `:408-423`: unlocked SELECT, status check in JS, unconditional UPDATE. Cancel racing "attended" ends with whichever wrote last, e.g. request `attended` while its session was cancelled by `cancelCorporateSession`.
Fix: single conditional UPDATE (`WHERE status = 'scheduled'` / `WHERE status IN ('pending','scheduled')`) and decide from `RETURNING`.

### D-07 — P2 — CONFIRMED — Workshop list returns every workshop, with full description HTML, unordered
Evidence: `services/workshops/publish.ts:257-270` — `select()` with no limit and no `orderBy`; `routes/portal/admin/workshops.ts:200-213` serialises `description_html` (up to 20 000 chars, `workshops.ts:47`) for each row. The list view needs name, location, lifecycle and lineup.
At target load: payload grows linearly with workshop history (cancelled ones included when `lifecycle` is omitted); 200 workshops with rich descriptions is a multi-megabyte response re-fetched on every Schedule/Workshops visit. Row order is whatever the planner returns, so the client must sort.
Fix: project list columns only (drop `description_html`), `ORDER BY created_at DESC`, add `limit`/cursor, default `lifecycle=active`.

### D-08 — P1 — CONFIRMED — A workshop save runs ~10 statements per day and ~9 per tier, serially, while holding the workshop row FOR UPDATE and every day's room lock
Evidence: `services/workshops/schedule.ts:85-88` / `:128-130` take `getWorkshop(…, { lock: true })` (`publish.ts:142`, `FOR UPDATE`) and `claimDayRooms`; `writeSchedule` (`schedule.ts:149-186`) then loops: per kept day `updateDay` = `ensureWorkshop` + day read + `assertRoomInLocation` + occupancy lock + clash read + UPDATE + `recordSessionChanged` (`days.ts:98-168`); per tier `updateTier` = `ensureWorkshop` + tier read + `ensureDaysBelong` + UPDATE + DELETE + INSERT of tier-days + a full `listTiers` (3 more) to return one row (`tiers.ts:139-194`); plus `listDays`/`listTiers` before and after. Nothing caps `days` or `tiers` (`routes/portal/admin/workshops.ts:112-123`). A member's checkout takes the same workshop row `FOR KEY SHARE` (`tiers.ts:203-214`, `checkout.ts:53`), which `FOR UPDATE` blocks.
At target load: saving a 10-day, 4-tier workshop is ~150 sequential round trips (roughly 0.3-1 s on a remote database); every member starting checkout for that workshop waits behind it, and any class/PT schedule write wanting one of those rooms waits on the advisory locks. An uncapped body (say 500 days) turns this into a multi-second lock and a pool connection pinned.
Fix: cap `days` (e.g. 60), `tiers` (20), `day_refs`, `promotions`, `image_r2_keys` in zod; in `writeSchedule` read the workshop, days and tiers once and pass them down instead of re-reading per item; batch tier-day rewrites; stop `updateTier` calling `listTiers`; record one "schedule changed" update per save rather than one per day.

### D-09 — P2 — CONFIRMED — The granular workshop routes and the basics-only save skip the workshop lock the combined save relies on
Evidence: `updateWorkshop` reads with `getWorkshop(tenantId, id)` and no lock (`publish.ts:159`) and is the path for a basics-only PATCH (`routes/portal/admin/workshops.ts:348-349`); it replaces the image set by DELETE + INSERT (`publish.ts:237-250`). `createDay`, `updateDay`, `createTier`, `updateTier` use `ensureWorkshop` without `{ lock: true }` (`days.ts:55, 98`; `tiers.ts:93, 139`); only `deleteTier` and the two schedule saves lock. `updateDay`/`updateTier` read `existing` unlocked (`days.ts:99-110`, `tiers.ts:140-151`) and validate against it.
What happens: two admins editing one workshop — last write wins field by field with no version check; two concurrent image saves can interleave DELETE/INSERT and leave both sets or trip the `ord` uniqueness; a day edit racing `cancelWorkshop` (`cancel.ts:33-38`, locked) edits a cancelled workshop's day because `ensureWorkshop` saw it active.
Fix: take the workshop row `FOR UPDATE` (or `FOR NO KEY UPDATE`) at the top of every workshop write and re-check lifecycle under it; add an `updated_at`/version precondition (`If-Match` or `expected_updated_at`) to PATCH so a stale editor gets 409 instead of overwriting.

### D-10 — P1 — CONFIRMED (mechanism) / SUSPECTED (frequency) — Workshop capacity is neither locked at purchase nor checked on edit, and a day can be deleted under a sale
Evidence: `services/workshops/book.ts:96-97` states the gate is "Best-effort (no row lock)"; `assertWorkshopBookable` counts confirmed places (`book.ts:134-135`, `capacity.ts:21-41`) and returns, with no lock on the day rows or the workshop beyond `KEY SHARE`, so two members buying the last place both pass. `updateDay` accepts any `capacityOnline` without comparing it to confirmed places (`days.ts:117-121, 146`). `deleteDay` counts confirmed bookings then deletes with no lock (`days.ts:198-226`) and, unlike `deleteTier`, does not consult `payableSalesOfWorkshopTier` (open/unpaid purchases).
At target load: a popular workshop release with 100 members online oversells by the number of concurrent buyers in the read-to-insert window (paid flow widens it to the Stripe round trip). An admin lowering capacity or removing a day while a member is at Stripe produces a paid booking for a day that no longer exists or is over capacity.
Fix (member-API slice owns the purchase side; noted here because the admin edits share the invariant): serialise per workshop day with `SELECT … FOR UPDATE` on the covered `workshop_days` rows (ordered by id) in both the purchase gate and `updateDay`/`deleteDay`; refuse `capacity_online < confirmed` unless an explicit override is sent; make `deleteDay` take the workshop lock and check unfinished purchases as `deleteTier` does.

### D-11 — P2 — CONFIRMED (queries) / SUSPECTED (cost) — GET /classpass writes on every read and recomputes whole-history aggregates
Evidence: `services/classpass/settings.ts:104-113` runs `INSERT … ON CONFLICT DO NOTHING` then a SELECT on every page read; `:117-121` groups every inbound email of the tenant; `:149-161` scans them again for two filtered aggregates; `:166-169` takes `min(booked_at)` over `bookings WHERE source = 'classpass'` and `:193-203, 215-230` join bookings filtered by `source`/`seat` — `db/schema/bookings.ts:88-119` has no index leading on `source`, so these read the tenant's bookings. `checkClassPassRosters` (`classpass/roster.ts:151-230`) then loads the full `text` and `html` of every roster email from the last 7 days and parses them in Node on each call. All ~12-14 statements are sequential.
At target load: an occasional Admin page, not polled, so the cost is latency on that page (hundreds of ms growing with email and booking history), plus a no-op write that takes a row lock and WAL on a GET.
Fix: create the settings row at tenant provisioning (or only on PATCH) and make the GET read-only; fold the two email aggregates into one statement; add a partial index `bookings (tenant_id, booked_at) WHERE source = 'classpass'`; persist the parsed roster (or the computed differences) when the roster email is received instead of re-parsing HTML per page view.

### D-12 — P2 — CONFIRMED — ClassPass review queue: unbounded list carrying every email body; mapping a location re-places every waiting email in one request
Evidence: `services/classpass/review.ts:65-71` has no limit and selects `text` and `html` (`review.ts:57-58`) for every open item; the route serialises both (`routes/portal/admin/classpass.ts:40-41`). `rerunOpenReviewAt` (`classpass/review-items.ts:76-105`) selects **all** open booking emails with bodies `FOR UPDATE`, filters by location in JavaScript (`:95`), then for each match runs `placeClassPassBooking` in its own savepoint sequentially (`:97-103`) — a full class booking each (class match, client upsert, seat, booking insert). It is called from add/change mapping and from the review "location" action (`locations.ts:99, 139, 169`). `mapClassPassReviewLocation` then returns every re-run item with bodies (`review.ts:160-167`).
At target load: a studio that enabled the import before mapping its locations has hundreds of open items; the review page downloads hundreds of HTML emails (multi-MB), and the first mapping holds row locks on all of them plus the class/seat locks of each placement for the whole request — inbound webhook deliveries for those emails and member bookings on the same classes wait behind it.
Fix: list returns metadata only with `limit`/cursor, bodies fetched per item on demand (`GET /review/:id`); filter the rerun by a stored normalised `location_name` column in SQL and select bodies only for matches; process the rerun in bounded batches (e.g. 25 per request with a "n remaining" answer) or as a background job per tenant.

### D-13 — P2 — CONFIRMED — Missing zod bounds on arrays and strings in this slice
Evidence: `routes/portal/admin/workshops.ts:54` `supporting_instructors`, `:55` `image_r2_keys`, `:68-70`, `:96, 107` `day_ids`, `:113, 118, 121` `days`/`tiers`/`day_refs`, `:137-139` `promotions` — none has `.max()`; `:29-33` `priceField` accepts any string/number with no upper bound and throws from inside a transform; `:74` `ord`, `:82-84` capacities have no upper bound. `routes/portal/admin/pt-sessions.ts:45` `supporting_instructors`; `routes/portal/admin/corporate-sessions.ts:23` and `corporate-requests.ts` `supporting_instructor_ids`; `routes/portal/pt-manual.ts` `members` has `.min(1)` and no `.max(2)` (the service refuses, after work). `routes/portal/pt-cancel-note.ts:19` reads the raw body with `c.req.text()` before any size check (relies on a global body limit — cross-slice: confirm one exists).
Fix: add `.max()` to every array (instructors 10, images 20, days 60, tiers 20, promotions 20, members 2), sane numeric maxima for capacity and price, and `.max(2)` on members.

### D-14 — P3 — SUSPECTED — Partner lookup by `lower(email)` may not be indexed
Evidence: `services/pt-sessions/request.ts:329` and `list.ts:713` filter `lower(clients.email) = $1` within a tenant. Whether a functional index on `(tenant_id, lower(email))` exists is the index auditor's inventory; without it each link-partner call scans the tenant's clients.
Fix: confirm or add `clients (tenant_id, lower(email))`.

### D-15 — P3 — CONFIRMED — Redundant reads on the PT edit path
Evidence: `services/pt-sessions/schedule.ts:595-602` and `:664-669` read the seated members and take `lockMemberTime` twice in one edit; `:534` peeks the session, `:543` re-reads it locked, `:729-733` reads it a third time after the roster write; `readInstructors` runs before and after (`:699, 749`) plus `ptSubject` (`:747`); `tenantTimezone` is awaited per call site (`manual.ts:195, 223`; `schedule.ts:518`) — cheap only if `loadTenantById` is cached (cross-slice: verify). Each mutating PT route then re-hydrates the request with 3-5 more reads (`pt-request-routes.ts:180, 202, 245`).
At target load: PT writes are low-frequency; this is ~10 avoidable round trips per edit, not a capacity risk.
Fix: reuse the first seated read; return the locked row from the UPDATE … RETURNING; pass the timezone down.

---

## Findings E: Super portal: tenants, transfer (export/import), maintenance, sign-in

### E-01 - Tenant export / import run inside the API process and block the event loop and memory for every studio
- Severity: **P1**. CONFIRMED (code path), SUSPECTED (duration - needs a timed run with a real studio archive).
- Evidence:
  - Export reads every table whole into JS arrays: `be/src/services/tenants/transfer.ts:143-152` (`SELECT * FROM <table>` with no WHERE, no cursor), then `JSON.stringify(rows, null, 2)` per table synchronously in `be/src/services/tenants/transfer-archive.ts:54-61`, then JSZip in-process (`transfer-archive.ts:64`), then a full extra copy for the response (`be/src/routes/platform/transfer.ts:75-78`, the comment admits "one extra copy of an archive already held whole in memory").
  - Import holds the upload as chunks and then `Buffer.concat` (2x the archive) - `be/src/services/tenants/import-jobs.ts:331-356,397`; cap is 1 GiB (`import-jobs.ts:52`). Unpack is JSZip + synchronous `JSON.parse` of each table file (`transfer-archive.ts:82-122`). Row preparation is a synchronous `.map` over every row of every table (`transfer.ts:610-629`), and each batch builds a SQL statement of up to 20,000 parameters in JS (`transfer.ts:978,1010-1020`).
  - The code's own sizing comment: "a studio importing its whole history brings hundreds of thousands of rows" (`transfer.ts:988-989`).
- At 100 members + 10 admins: Node is single-threaded. While an operator exports or restores one studio, every `JSON.stringify`/`JSON.parse`/row-map over a large table is a multi-hundred-millisecond to multi-second stall during which **no** request from any studio is served (bookings, check-ins, webhooks). A 1 GiB archive at 2-4x in-memory expansion can also OOM the single backend process, taking every studio down and - because `runImport` is a detached promise in the same process (`import-jobs.ts:397`) - killing the import with it.
- Fix: move export/import off the request-serving process: a separate worker process (or `worker_threads`) fed by the `tenant_imports` job row, which already exists. Stream the export (`COPY ... TO STDOUT` or a server-side cursor per table → streaming zip → R2 object, hand the operator a signed URL). Stream the import upload to disk/R2 instead of RAM, and parse table files with a streaming JSON parser. Lower `MAX_ARCHIVE_BYTES` to what the box can actually hold until then.

### E-02 - Export holds one REPEATABLE READ transaction and a pooled connection for the entire dump
- Severity: **P2**. CONFIRMED.
- Evidence: `transfer.ts:140-178` - ~75 sequential `SELECT *` statements in one `withTenant(..., { isolation: 'repeatable read' })`. The pool is `postgres(url)` with no options (`be/src/db/index.ts:27`), i.e. postgres.js's default of 10 connections, and no `statement_timeout`/`idle_in_transaction_session_timeout` is set anywhere in `be/src/db/` (grep finds none).
- At target load: one of ten connections is gone for the length of the export, and a long snapshot holds back vacuum on hot tables (bookings, ledger). Two operators exporting two studios take 20% of the pool.
- Fix: as E-01 (streamed/worker export on a dedicated connection outside the request pool). Cross-slice: pool size and timeouts belong to the DB-pool auditor.

### E-03 - Replace-import does not require the studio to be suspended; it deletes and rewrites every row of a live studio in one long transaction
- Severity: **P1**. CONFIRMED (no precondition), SUSPECTED (lock-wait impact).
- Evidence: `importTenant` checks slug, archive version, zone and `auth_user_id` (`transfer.ts:412-470`) and then, for `mode: 'replace'`, locks only the `tenants` row and calls `clearStudioRows` (`transfer.ts:523-541`, `835-856`) - one `DELETE FROM <table> WHERE tenant_id = ?` per table, followed by all inserts, in the same transaction. Contrast `deleteTenant`, which refuses unless the studio is suspended (`be/src/services/tenants/delete.ts:110,121`). Nothing in `importTenant`/`startImport` reads `tenant.status`.
- At target load: members of that studio keep booking during the replace. Their `INSERT INTO bookings` / `UPDATE class_sessions` statements block on the row locks and FK checks against rows the import has deleted-but-not-committed, for as long as the import runs (minutes). Each blocked request is a request-long transaction holding one of the 10 pooled connections (`be/src/middleware/tenant.ts:102`), so ~10 blocked members of the studio being replaced exhaust the pool for **every** studio. When the import commits, the blocked writes then fail on FK violations or succeed against rows from the old world.
- Fix: refuse `replace` unless `tenants.status = 'suspended'` (same rule as delete), or have the import suspend the studio (and drop the tenant cache) before clearing and restore the prior status on commit. Add `SET LOCAL lock_timeout` to tenant request transactions so a blocked member request fails fast instead of pinning a connection.

### E-04 - Import creates logins one member at a time (N+1 inside the import transaction)
- Severity: **P2**. CONFIRMED.
- Evidence: `transfer.ts:569-581` - `for (const row of rows[table]) { ... await ensureAuthUser(db, pool, {...}) }` for every `clients` and `staff_users` row; each call is at least a lookup plus an insert. Pass two is the same shape: one `UPDATE ... WHERE id = ?` per row of every table with a deferred column (`transfer.ts:644-668`).
- At target load: a studio with 5,000 members is 10,000+ sequential round trips before the first domain row is written, inside the transaction that E-03 shows can be blocking live traffic, and on a connection taken from the request pool.
- Fix: batch both - `INSERT ... SELECT FROM unnest(emails, names) ON CONFLICT DO NOTHING RETURNING` for the logins, and `UPDATE t SET col = v.col FROM (VALUES ...) v WHERE t.id = v.id` in batches for pass two, as `insertRows` already does for pass one.

### E-05 - The one-request import route has no size limit and buffers the multipart body twice
- Severity: **P2**. CONFIRMED.
- Evidence: `be/src/routes/platform/transfer.ts:115-127` - `c.req.parseBody()` then `Buffer.from(await file.arrayBuffer())`. `importNow` passes `bytes.byteLength` to `startImport` so the 1 GiB check runs only **after** the whole body is already in memory (`import-jobs.ts:219,260`). No `bodyLimit` middleware is mounted in `be/src/app.ts` (grep for `bodyLimit` finds nothing).
- At target load: a single mistaken upload (or a platform-admin token used by a script in a loop) can exhaust the process's memory. Platform-admin gated, so risk is operational, not hostile.
- Fix: mount Hono's `bodyLimit` on `/api/v1/platform/tenants/:id/import` (and a small default limit on the whole API - cross-slice), or retire this route in favour of the job route.

### E-06 - `GET /platform/imports` opens one transaction per tenant, sequentially, and writes on a read
- Severity: **P2**. CONFIRMED.
- Evidence: `import-jobs.ts:567-583` - `for (const tenantId of ids) { await withTenant(tenantId, async () => { await expireStale(tenantId); select ... }) }`. `ids` is every row of `tenants` with no status or `e2e-` filter (`import-jobs.ts:568`), unlike `listTenants` (`tenants.ts:217`). Each iteration is BEGIN + set_config + UPDATE + SELECT + COMMIT = 5 round trips.
- At target load: with 30 studios plus leftover `e2e-` studios on staging this is 150+ sequential round trips on every load of the super-portal list. Harmless today, linear forever, and the UPDATE in `expireStale` takes a write on a GET.
- Fix: a `SECURITY DEFINER` function owned by the table owner (the pattern migration 0041's `tenant_staff_counts()` already uses) returning the latest open import per tenant in one query; run `expireStale` only for rows that query shows as stale.

### E-07 - Import job state that decides replace-vs-restore lives in a process-local Map
- Severity: **P2**. CONFIRMED.
- Evidence: `import-jobs.ts:82` (`requestByJob = new Map`), `:68` (`live = new Set`), read at `:324` - "An upload for a job this process has no record of runs as a restore". `runImport` is a detached promise (`:397`).
- At target load: correct only for exactly one backend process. The day a second instance (or a PM2 cluster / rolling deploy overlap) exists, a `replace` started on instance A and uploaded to instance B silently runs as a `restore`, and `expireStale` on B will fail A's live job after 30 s because B's `live` set does not contain it.
- Fix: persist `mode` and the confirmed slug on `tenant_imports`; make liveness a DB heartbeat only (already there) rather than the in-memory set; run the job in the worker from E-01.

### E-08 - Minor: sequential awaits and an unvalidated id on platform routes
- Severity: **P3**. CONFIRMED.
- Evidence: `be/src/routes/platform/tenants.ts:278,330,500,528` - `serialize(x, await staffCountFor(id), await providerAccountStatus(id))` runs two independent reads back to back. `be/src/routes/platform/transfer.ts:49-50` passes `c.req.param('id')` to `loadTenantById` without the `uuid` parse every sibling route does, so a malformed id is a Postgres cast error (500) instead of a 404.
- Fix: `Promise.all` the two reads; add the `z.string().uuid().safeParse` guard to the export route.

### E-09 - Cross-slice: the portal/platform rate limiter can never key on the staff member
- Severity: **P1** for the portal at the target load. CONFIRMED (ordering), SUSPECTED (which IP the backend sees in production).
- Evidence: `be/src/app.ts:97-102` keys `authedLimiter` on `c.get('clientId') ?? c.get('staffUserId') ?? x-forwarded-for ?? 'global'`, and it is mounted at `app.ts:120-122` **before** `resolveTenant` and before the routers whose `staffAuth` sets `staffUserId` (`be/src/routes/portal/index.ts:32`). `keyGenerator` runs before `next()`, so both context values are always undefined and the key is always the forwarded IP or the literal `'global'`.
- At 100 members + 10 admins: 300 requests/minute is shared by everyone behind one address. Ten admins on one studio's office network share one bucket with each other and with every member on the studio wifi; a portal page that fires 8-15 requests plus the bell poll burns through it in normal use and the whole front desk gets 429s. If the frontends call through a server-side proxy that does not forward the client IP, the bucket is `'global'` - 300/min for the entire platform.
- Fix: (auth/middleware auditor owns this) mount the authed limiter after the auth middlewares, or derive the key from the bearer token hash; give staff a larger budget than members.


---

## (d) Checked and fine

### A: Attention, leave, staff, instructor payroll, policy, impersonation, small settings

- Tenant scoping: every query read in this sub-slice carries an explicit `tenant_id` predicate in addition to RLS (spot-checked in all 23 attention providers, leave, payroll, policy, staff).
- Leave decision races: `decideLeaveRequest` and `transitionOwnLeaveRequest` lock the request row `FOR NO KEY UPDATE` before checking the state rule (`services/leave/requests.ts:1201-1206`, `:779-790`), so two admins approving/rejecting the same request, or an admin deciding while the applicant withdraws, cannot both succeed.
- Leave submission: applicant and partner rows locked in a fixed order (`requests.ts:605-617`), occupancy locked before the conflict check (`:554`), admin mail deferred with `afterCommit` (`:767`).
- Leave pool materialisation: insert-ignore then re-read (`requests.ts:223-245`), safe under concurrent first reads.
- Last-admin protection on archive / role change takes `FOR UPDATE` on the active admins (`services/auth/staff-archive.ts:91-103`), so two admins archiving each other cannot leave the studio with none.
- Staff email change is serialised per staff member by `pg_advisory_xact_lock` (`services/auth/staff-email-change.ts:199`).
- Attention dismissal: idempotent under a race via `onConflictDoNothing` + 404 on zero rows (`services/attention/dismissals.ts:31-42`); `kind` validated against the registry enum; `limit_per_group` capped at 50; updates cursor shape and date validated (`routes/portal/attention.ts:24-31`, `attention/updates.ts:271-278`).
- Updates tab: keyset pagination, 20 per page (`attention/updates.ts:296-331`); retention prune exists (`:364-370`).
- Attention lists that DO push `LIMIT` into SQL: pt requests, corporate x3, leave, check-in, waitlist, series x2, ClassPass review, staff invitations, staff without email.
- `studio_term_ending` reads the memoised tenant row (`services/tenants/tenants.ts:75-92`), no query.
- Instructor payroll forces `instructorId` from the session, never the query (`routes/portal/instructor/payroll.ts:32-34`).
- Impersonation: target must be a staff row of the same tenant, header UUID-validated before it reaches Postgres (`middleware/impersonate.ts:35-46`); one indexed lookup, only when the header is present. Client impersonation mint is 1 read + session insert.
- `audit` middleware: one INSERT per successful mutation, skipped for reads and for handlers that filed their own row (`middleware/audit.ts:39-41,79`).
- Policy scalars are all range-bounded in zod (`routes/portal/admin/policy.ts:13-57`); `updatePtBookingConfig` locks the row before its cross-field check (`services/policy/update.ts:232-236`).
- Marketing PATCH: every field length-capped, testimonials capped at 20 (`routes/portal/admin/marketing.ts:9-18`).
- Upload size limits enforced before buffering (`bodyLimit`) and re-checked on the real byte length (`routes/portal/leave.ts:109-119`, `routes/profile-picture.ts:26-29`).
- No ILIKE / free-text search endpoint exists in this sub-slice.
- No CSV/export endpoint exists in this sub-slice.

Cross-slice notes: `postgres(url)` uses the default pool of 10 (`db/index.ts:27`), which is the multiplier behind A-01, A-06, A-08, A-09; the portal refetches the summary on every `pathname` change (`fe-portal/src/components/attention/attention-provider.tsx:118-120`).

### B: Schedule, bookings, check-in, waitlist, catalog

- **Capacity edit vs concurrent member booking:** `updateClass` takes the class row `FOR UPDATE` before reading anything (`services/schedule/classes.ts:210-215`), the same lock `bookIntoClass` takes first (`services/bookings/book.ts:130`, `:299-319`); the online-capacity floor is counted under that lock (`classes.ts:249-254`). No oversell window.
- **Cancel class vs concurrent booking:** `cancelClassInTx` locks the class row first (`cancel-class.ts:76-88`); a booking that was waiting then sees `lifecycle !== 'active'` and gets `class_not_found` (`book.ts:133`). A double cancel by two admins gets `class_not_active` (`cancel-class.ts:93`).
- **Staff add / waitlist join / promote / remove vs member book:** all take `lockClass` first (`book.ts:130`, `services/waitlist/staff.ts:133, 198`, `services/waitlist/entries.ts` join) and count seats under it (`countSeats(tx, …)`), so seat decisions are serialised per class. One-waiting-entry-per-member is also enforced by a unique index (`db/schema/bookings.ts:233`).
- **Staff cancel of one booking vs cancel class / promotion:** `cancelBookingInTx` locks the parent before the booking (`services/bookings/cancel.ts:152`, `:171`) and is wrapped in `retryingTransaction` for the promotion deadlock case (`cancel.ts:125`, `db/index.ts:197-215`); `fn` reaches mail only through `afterCommit`, so a retry sends nothing twice.
- **Package-rule change vs booking:** applied last under the class lock (`classes.ts:342-348`), retried on deadlock (`classes.ts:206`).
- **Two extends of one series:** serialised on the series row (`series.ts:252`, `:452`), and dates already holding a class of the series are skipped (`series.ts:304-325`). `endSeries` locks future classes in id order, matching `lockForCancel` (`services/bookings/lock-for-cancel.ts:58-64`).
- **Room / instructor double-booking between two concurrent schedule writes:** `assertAvailable` takes advisory locks in sorted lock-id order before checking (`services/schedule/occupancy.ts:469-479`, `:496-500`), so two creates for the same room cannot both pass and cannot deadlock each other.
- **Check-in scan and manual tick:** booking row locked (`check-in.ts:81-94`), idempotent second scan (`:330-338`), `check_ins` insert is `onConflictDoNothing` over a unique index (`:214-218`, `db/schema/bookings.ts:195`); code and QR lookups are tenant-scoped unique-index hits.
- **No-show:** booking locked, state re-checked under the lock (`services/bookings/no-show.ts:25-41`).
- **Series range:** capped at 366 days for create and extend (`series.ts:64`, `:215`, `:299`), so a series can never create more than 53 classes per request; class insert is one multi-row statement (`series.ts:551-571`).
- **Check-in day list:** bounded to one studio day plus the open window (`check-in.ts:425-430`, `:455-456`).
- **Tenant timezone / tenant row:** served from an in-process TTL cache (`services/tenants/tenants.ts:67-92`), so the many `tenantTimezone` calls in these paths are not queries. Waitlist flag is in memory (`services/waitlist/line.ts:28`).
- **Mail is never sent inside the write transaction:** every send in this slice goes through `afterCommit` (`cancel-class.ts:229, 241-242`, `book.ts:185`, `classes.ts:367-368`, `staff.ts:182`), so row locks are not held across provider calls (the latency cost is B-04).
- **Instructor scoping is enforced in services, not routes:** `assertStaffReaches` (`book.ts:262`), `assertMayWorkClass` (`staff.ts:40`), `refuseIneligible` (`check-in.ts:174-184`), `not_main_instructor` (`cancel-class.ts:90`); `overbook` is dropped for instructors at the mount (`routes/portal/class-booking.ts:33-34`).
- **Catalog list endpoints** (locations, rooms, class types, instructor catalog) are unpaginated but read tens of rows per tenant with narrow projections.
- **Indexes present for the hot predicates in this slice:** `bookings (tenant_id, class_id, state)`, `bookings (tenant_id, pt_session_id)`, `waitlist_entries (tenant_id, class_id, status, joined_at)`, `classes (tenant_id, starts_at)` plus room / instructor / location / series variants (`db/schema/bookings.ts:98-100, 229`, `db/schema/schedule.ts:103-109`).

### C: Clients, finance, purchases, receipts, package catalogue, promo codes, merch

- Tenant scoping: every query read in this slice names `tenant_id` explicitly as well as relying on RLS (the two exceptions are subqueries noted in C-09, still covered by RLS).
- The clients list is paginated server-side with search, filter and sort in SQL, and the trial facts are read for the page's ids only (`services/clients/manage.ts:152-179`). The receipts list is paginated the same way.
- Double refunds: `refunds.create` carries an idempotency key per payment intent (`services/billing/refunds.ts:794`), a second press is refused as `refund_processing` or `already_refunded` (refunds.ts:849-851, 921-929), and the unwind is driven by the webhook, so a concurrent double-click cannot return money twice.
- `issueOpenPurchaseRefund` locks the purchase before deciding (refunds.ts:990-995), so it cannot interleave with a member resuming the same checkout.
- `setPackageExpiry` locks the package row before checking paid bookings (`services/packages/adjust.ts:435-443`), so a booking made concurrently is seen.
- Credit debits and returns from bookings lock the package row (`services/packages/ledger.ts:107-123`); `removeComplimentaryPackage` runs in a retried transaction with ordered locks (`services/packages/complimentary.ts:160, 187-214`).
- Member detail lists are capped (50 past, 50 cancelled, 100 upcoming, 50 payments, 50 adjustments) and the attendance summary is a single SQL aggregate, not a JS reduction.
- `listOpenPurchases` and `refundStatesFor` batch their per-purchase lookups with `inArray` instead of looping (open-purchases.ts:146-154; refunds.ts:190-197): no N+1.
- Promo code terms are frozen after the first redemption (`services/packages/promo-code-admin.ts:321-327`), so an edit cannot change what a member already accepted.
- Merch image upload has a `bodyLimit` ahead of the handler and type and size checks in the service (`routes/portal/admin/merch.ts:87`, `services/catalog/merch.ts:95-109`).
- String fields on member, package, merch and refund bodies carry max lengths; balance deltas are bounded by `MAX_PACKAGE_BALANCE`; pay amounts by `MAX_PAY_SGD`.
- Soft delete and restore of a member are idempotent and end the member's sessions immediately (`services/clients/manage.ts:408-437`).
- Package catalogue, corporate package, merch and promo code lists are unpaginated but are catalogue-sized by nature; not a finding.
- Outbound provider calls go through `lib/outbound.ts`, which enforces a deadline, so the connection-holding in C-05 and C-06 is bounded rather than indefinite.

### D: PT sessions, corporate, workshops, ClassPass

- **PT schedule double-submit**: `schedulePtRequest` re-reads the request `FOR UPDATE` inside the savepoint and returns `not_pending` to the loser (`pt-sessions/schedule.ts:156-165`).
- **PT cancel vs schedule vs member cancel**: `cancelPtRequestInTx` locks request → session → bookings `FOR UPDATE` (`pt-sessions/cancel.ts:138-143, 249-254, 362-372`), is wrapped in `retryingTransaction` for deadlock aborts (`:115`), and gathers mail only from the attempt that commits.
- **PT edit ordering**: `updatePtSession` locks request, then session, then room/instructors, then members, the same order as cancel and manual seat (`schedule.ts:528-545`), and decides on the row read under lock, so two retypes cannot double-debit.
- **Refund-vs-schedule**: package locked before the void check (`schedule.ts:242-248`).
- **Room/instructor double-booking**: every PT, corporate and workshop-day write goes through `assertAvailable`, which takes advisory locks before the clash read (`schedule/occupancy.ts:489-501`); member double-booking through `lockMemberTime` advisory locks taken in sorted order (`bookings/member-time.ts:157-164`).
- **Manual PT session seats**: `lockManualSession` + `seatsOn(... FOR UPDATE)` serialise add/remove/cancel (`pt-sessions/manual.ts:450-481, 512-524`); loops are over at most 2 members.
- **PT queue hydration is batched, not N+1**: slots, partners, bookings each one `inArray` read (`pt-sessions/list.ts:513-559`).
- **PT queue badge**: `countPtRequestsForAdmin` is a single count sharing the list's filter (`list.ts:669-679`), served by `pt_requests_status_created_idx` / `pt_requests_location_status_idx`.
- **Instructor PT queue**: forced to `status: 'pending'` and to requests the caller may take (`pt-request-routes.ts:292-293`); pending requests expire, so it stays small.
- **Workshop cancel write**: one `FOR UPDATE` on the workshop, one bulk UPDATE for all bookings (`workshops/cancel.ts:33-38, 82-98`); no per-attendee statement, no Stripe call in the request (refunds are deliberately manual). A repeat is refused `workshop_already_cancelled`.
- **Workshop cancel vs member checkout**: checkout's `FOR KEY SHARE` on the workshop row (`workshops/tiers.ts:203-214`) conflicts with cancel's and `deleteTier`'s `FOR UPDATE`, so they serialise.
- **Tier delete**: under the workshop lock, checks confirmed bookings, history and unfinished purchases before deleting (`tiers.ts:221-287`).
- **Corporate session cancel**: one conditional UPDATE (`lifecycle = 'active'`) decides the race; the request flip is conditional on `scheduled` (`corporate/sessions.ts:208-240`).
- **Corporate request creation**: idempotent per purchase via `ON CONFLICT DO NOTHING` on the unique index (`corporate/requests.ts:90-116`).
- **ClassPass review actions**: `lockOpenItem` takes the item `FOR UPDATE` and refuses a resolved one, so two admins cannot both book or dismiss it (`classpass/review.ts:83-100`); a location-mapping name race is caught on the unique index (`locations.ts:106-116`).
- **ClassPass roster check reads**: classes and bookings fetched in one read each, keyed in memory (`classpass/roster.ts:233-301`); the roster email read is bounded to 7 days (`roster.ts:141, 161`).
- **No Stripe call inside any request in this sub-slice.** No `ILIKE` search endpoint in this sub-slice.
- **Tenant scoping**: every query read here carries `eq(<table>.tenantId, tenantId)` in addition to RLS.

### E: Super portal: tenants, transfer (export/import), maintenance, sign-in

- `requirePlatformAdmin` (`be/src/middleware/platform-admin.ts:62-79`): one session read per request, allowlist re-read from env each time, no tenant transaction opened.
- Maintenance gate: `currentMaintenance()` caches the switch for 5 s per process and shares one in-flight read (`be/src/services/platform/maintenance.ts:37-56`) - no per-request DB read.
- Tenant resolution is memoised for 60 s, positive-only, and cleared on every tenant write (`be/src/services/tenants/tenants.ts:64-73,117-136`).
- `listTenants` avoids a per-tenant transaction by using the owner-owned `tenant_staff_counts()` function (`tenants.ts:203-242`) - 3 parallel queries regardless of studio count.
- `deleteTenant` is set-based (one statement per table, audit rows moved by `INSERT ... SELECT`), locks the tenant row, requires `suspended`, and purges R2 only after commit (`be/src/services/tenants/delete.ts:110-179`).
- `renameTenant` takes `FOR UPDATE` on the tenant row and does the slug swap + former-slug hold in one transaction (`be/src/services/tenants/rename.ts:80-149`).
- Import pass one is batched to 20,000 parameters per statement with content always parameterised (`transfer.ts:994-1022`); concurrent imports into one studio are arbitrated by a partial unique index (`import-jobs.ts:287-293`).
- Export uses REPEATABLE READ so the archive is one snapshot (`transfer.ts:131-178`) - correct for consistency (cost noted in E-02).
- Payment-credential onboarding calls Stripe outside any DB transaction (the platform branch opens no tenant context) - `be/src/services/billing/provider-onboarding.ts:139-197`.
- Mindbody download/transform (`be/tools/mindbody/**`) is offline CLI tooling, not mounted in the server; its only production contact is the archive it produces, which goes through the import path above (E-01, E-03, E-04).
