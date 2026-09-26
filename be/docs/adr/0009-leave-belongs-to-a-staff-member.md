# Leave belongs to a staff member, not an instructor profile

**Status**: accepted (2026-09-26) — amends `0001-per-instructor-leave-pools-with-carry-over.md`, whose Pools were keyed to an instructor.

Leave was built for instructors only. Requests and Pools referenced the `instructors` extension table, and the Assigned Days lived there too, so an admin who applied was refused `not_an_instructor`. The studio wants admins to request leave the same way, and in a studio with one admin that admin still needs a way to have leave approved. We are therefore keying leave to the **staff member**: `leave_requests` and `leave_pools` reference `staff_users`, and the three Assigned Days columns move onto `staff_users` with the same 14 / 14 / 7 defaults.

## Why this is a re-key and not a new table

An instructor's primary key is its staff user id, so every existing request and Pool already names the right staff row. Migration 0091 only moves the foreign keys and renames `instructor_id` to `staff_user_id`. No value changes, and nothing is backfilled except the Assigned Days, which 0090 copies across before 0091 drops them from `instructors`. It follows that **an instructor promoted to admin keeps their history and balances**. The rows never depended on the role, only on the person.

Everything 0001 decided still holds, now per staff member: the Pool is a stored grant materialised on first read, Taken and Committed are sums over requests, and an adjustment is bounded by Assigned plus Carried.

## What stays instructor-only

**Leave Conflicts and the study Leave Cap protect teaching cover**, which an admin is not part of. An admin's leave is never refused by them, never counted toward the cap, and never in a conflict pair. Which of the two someone is depends on their role, not on whether an `instructors` row exists, because a promoted admin keeps theirs. A declared pair naming someone since promoted stays stored, as an archived instructor's does, but refuses nothing, and no new pair can name an admin. The occupancy clash check needs no special case: an admin teaches no sessions, so for them it only finds their own leave.

## Consequences

- One self-service mount, `/api/v1/portal/leave`, serves both roles (list, submit, document upload and read, withdraw, cancel). It sits at the portal root like the leave calendar and replaces `/api/v1/portal/instructor/leave`, which is gone.
- The admin Leave queue lists every staff member's requests, each with the applicant's role. **Any admin may approve, reject or revoke any request, their own included.** There is deliberately no self-decision guard, because a one-admin studio would otherwise be stuck.
- The submission email goes to every active admin except the applicant. The decision email is skipped when the decider is the applicant, since they already know.
- The staff screen edits Assigned Days and Remaining for admins too, and the staff list carries leave figures for everyone. The `leave_days_instructor_only` refusal is gone.
- A person's Pool is serialised by a `FOR NO KEY UPDATE` lock on their own `staff_users` row, which replaces the `instructors` row lock. An instructor's submission still takes the `instructors` rule lock first, in staff-user-id order, as the policy save does.
- A studio archive taken before 0091 still restores. The importer renames `instructor_id` on the two leave tables and moves an instructor's Assigned Days onto their staff row (`services/tenants/transfer-upgrade.ts`).
- 0091 renames and drops in one deploy, which goes against the "migrations only add" rule in `src/db/migrations/README.md`. Between that migration and the container swap, the outgoing image's leave pages and staff list fail. We accepted that window, as 0065 did, rather than carry dual columns for a low-traffic feature.
