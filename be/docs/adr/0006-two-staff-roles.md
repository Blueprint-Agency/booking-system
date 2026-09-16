# A studio's portal has two staff roles: admin and instructor

**Status**: accepted (2026-09-16).

## Context

A studio's portal had three staff roles — superadmin, admin, instructor — and most of running a
studio was reserved for the top one: the catalogue (locations, class types, instructors,
packages, promo codes, corporate sessions), policy, waiver, notifications, marketing and feature
flags; inviting, archiving and deleting staff; writing to clients, workshops and rooms, which
admins could only read; and impersonating a member.

Superadmin was a single-studio idea. It was the one person who bootstrapped a deployment, seeded
by `db/seed/superadmin.ts` from a deploy-time email variable. On a multi-tenant platform
studios arrive by being created or restored from the super portal, and the first staff member a
studio gets is an **admin**. Nobody on any provisioned studio was a superadmin, and nothing in
the product could make one — so every "only a superadmin may…" rule had quietly become "nobody
may, ever", and the admins who run a studio were locked out of running it.

The name was also a hazard. "Superadmin" reads as the **platform administrator** who operates the
super portal, a different thing entirely: signed in through the `platform` pool, named by
`PLATFORM_ADMIN_EMAIL`, and outside every studio's rows.

## Decision

A studio's portal has exactly **two staff roles, `admin` and `instructor`** — in the Postgres
`staff_role` type, the backend's role and invitable-role types, and the portal's.

**Admin gets every power superadmin had**: catalogue and policy, staff management (including other
admins), clients read-write (with delete and restore), workshops and rooms read-write, workshop
cancellation, and impersonation. Route gates that allowed only superadmin allow admin; gates that
allowed "superadmin or admin" allow admin. The admin read-only middleware is deleted, not left as
a no-op. An instructor keeps exactly what they had.

**Rank is admin > instructor.** The staff-edit rule is unchanged — nobody edits a staff member
who outranks them — so instructors cannot edit admins and admins can edit anyone. Role changes
require admin. Changing your own role and archiving yourself stay refused.

**The last-admin guard.** Archiving a staff member, or changing their role away from admin, is
refused when the target is the studio's only active admin — role `admin`, status `active`, not
soft-deleted. The count and the write run in one transaction, so two concurrent removals cannot
both pass. Deleting requires an already-archived row, so it needs no check of its own. Signing a
staff member out everywhere is not guarded, because they can sign back in. The guard lives in one
place in the staff service so every removal path shares it; its error codes name the last admin.

**Location grants are retired.** Superadmins saw every location implicitly and admins were limited
to `staff_users.granted_location_ids`; instructors never used grants. Admins now see all of the
studio's active locations. With no role left reading grants, they stop being set on invite, edit
and invitation accept, and the column is dropped.

**Migration.** One migration: update every `staff_users` and `staff_invitations` row with role
`superadmin` to `admin`, then recreate `staff_role` without `superadmin` (Postgres cannot drop an
enum value in place — create the new type, move the columns, drop the old one), and drop
`granted_location_ids`. The tenant restore path maps `superadmin` to `admin` on staff rows and
invitations, so archives taken before the migration still import.

**That deploy variable and its seeder are removed** — from `env.ts`, `.env.example`, the deploy
workflow, the test harness, and `db/seed/`.

## Consequences

- **Every provisioned studio can run itself.** The first admin a platform administrator creates can
  set the studio up without anyone acting on its behalf.
- **A studio cannot lock itself out** through the portal: the last active admin cannot be archived
  or demoted until another admin is promoted.
- **API contract changes.** Role values are `admin | instructor`; `is_seeded_superadmin` is gone
  from the portal `me` and staff-list responses; error bodies that listed
  `required: ['superadmin']` list `admin`; error codes containing `superadmin` are renamed.
  The portal ships in the same change.
- **Impersonation names the acting staff member**, not "the superadmin", in the signed grant, the
  audit middleware and the auth-session field. The sign-in audit log records the admin's staff auth
  user as actor, as before.
- **No finer-grained permissions.** There is no per-feature toggle and no per-location admin. If
  location-scoped admins are needed again, that is a new decision, and grants would come back
  with a role that reads them.
- **Platform administrators are untouched** — the super portal, the `platform` pool and
  `PLATFORM_ADMIN_EMAIL` do not change, and neither role is ever called by the platform's name.
- Historical plans under `docs/superpowers/` keep the old word; they are records of past decisions.
