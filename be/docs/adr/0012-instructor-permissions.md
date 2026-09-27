# An Instructor has three permissions an Admin switches, not a role of their own

**Status**: accepted (2026-09-27) — supersedes the "no finer-grained permissions" consequence of
`0006-two-staff-roles.md`. The two roles, their rank and the last-admin guard stand.

## Context

A studio's portal has two staff roles, and every Instructor has the same powers: putting classes
and weekly Class Series on the public timetable, cancelling their own class (which refunds every
member), accepting PT Requests onto their own calendar, and changing who is in their class — booking
members, working the Waitlist, cancelling a booking with the choice to keep the member's credit.

Studios have instructors they trust to run their own schedule and instructors who should only turn
up and teach. An Admin could not tell them apart: the only lever was the role, and taking the role
away removes the check-in desk and the roster the person needs to teach at all. Admins ended up
either handing scheduling to everyone or asking instructors not to press buttons they could see.

ADR 0006 closed the door on per-feature toggles because the immediate problem was a third role
nobody could hold. The problem here is different — not who runs the studio, but how much of the
timetable one Instructor may touch — and it is real.

## Decision

Keep the two roles. Give every Instructor a fixed, small set of **Instructor Permissions**, each a
switch an Admin sets per person:

| Key | Label | Grants |
|---|---|---|
| `schedule_classes` | Schedule classes | Create a class, preview and create a Class Series, cancel a class they lead |
| `take_pt_bookings` | Take PT bookings | See the pending PT Request queue, schedule a request to themselves, cancel a PT session they lead |
| `manage_rosters` | Manage rosters | Search members, book a member into a buffer seat, join, promote and remove on the Waitlist, cancel a member's booking |

**The list is fixed in code and grows only by decision.** It is a Postgres enum
(`instructor_permission`), not a table an Admin adds rows to. A fourth permission is a new enum
value, a backfill, and a decision about whether it defaults on or off.

**A permission bundles every action one job needs.** No combination of switches leaves a
half-working screen: an Instructor who may schedule may also cancel what they scheduled; one who
may manage a roster may do everything the roster page offers. Splitting create from cancel, or
schedule from cancel for PT, was considered and left for a later decision.

**Anything an Instructor needs to teach is role membership, not a permission.** Their own
timetable, the roster of a class they lead, check-in by scan, code or manual tick, their own leave,
their own teaching log and their own profile are never gated. Turning every switch off leaves a
person who can still teach.

**Admins are never gated.** An Admin resolves to every permission without a read, so an Admin
acting on an instructor surface is treated exactly as before. The switches describe Instructors and
nothing else; setting them on an Admin is refused rather than stored and ignored.

**Storage.** A `permissions` column on the existing `instructors` profile row: an array of the
enum, `NOT NULL`, defaulting to all three. The row already holds instructor-only attributes, is
made at invitation time (so a pending Instructor has one), cascades with the staff row and sits
under Row-Level Security, so there is no new table, policy or transfer entry. The default lives in
the column, so every path that makes an instructors row — invitation, a role change to Instructor,
the provisioning fixtures, the Mindbody import, the restore of an archive taken before the column —
gets all three without knowing about them.

**Resolution and enforcement.** `staffAuth` resolves the caller's set on every request, after the
staff row: everything for an Admin, the profile row's array for an Instructor, read fresh and never
cached across requests, so a revocation is felt on the next request with no new sign-in.
`requirePermission(key)` (`middleware/require-permission.ts`) sits beside the role gate in the
instructor subtree, applied per route, and refuses `403 forbidden_permission { required }`. It
runs after the role gate, so a non-staff caller sees the existing refusals unchanged, and before
any ownership check in the service, so an Instructor with a switch off on someone else's class is
told about the permission, not the ownership.

**The backend refuses, the portal hides.** The portal learns the set from `me` and hides what would
be refused; that is a convenience, and the backend is the truth.

**Lifecycle.** A new Instructor gets all three unless the invitation states a subset. A staff member
changed from Admin to Instructor gets a profile row with the default. One changed from Instructor to
Admin keeps their profile row and its permissions, so a promotion and a demotion later put them back
where they were. Permissions at one studio have no bearing on the same person's at another: the row
is per Tenant, like the staff row it hangs off.

## Consequences

- **Every existing Instructor has all three at deploy.** The migration's default backfills every
  current row; nobody loses a power they had yesterday without an Admin deciding it.
- **API contract.** The portal `me` gains `permissions: string[]` (the granted keys; all three for
  an Admin, so the portal has one shape). The staff list and the row a staff write returns gain
  `permissions: string[] | null` (`null` for an Admin). The staff invite and update bodies accept an
  optional `permissions` array; on an Admin, or in a request that also makes the target an Admin,
  the update is `400 permissions_require_instructor` and nothing is written; a duplicate key fails
  validation. `forbidden_permission` joins the error catalogue.
- **The two places the rule lives** are this middleware and the portal's "may this staff member do
  X" helper. Anything that starts deciding a button from `role === 'instructor'` should be routed
  through the helper instead.
- **ADR 0006's "no finer-grained permissions" is superseded** by this fixed list. Its other
  consequences — no per-location admin, no third role, no role editor — stand. A studio-wide default
  for new instructors, a per-studio policy on Keep credit, and any permission on Admins are out of
  scope and would be new decisions.
- **This ticket enforces `schedule_classes`.** `take_pt_bookings` and `manage_rosters` are stored
  and settable from the same change, and enforced by the tickets that follow under #327:
  `take_pt_bookings` by #330, on every instructor PT request route, the queue read included;
  `manage_rosters` by #331, on member search, booking a member in, the waitlist routes and the
  booking cancel, gated where the instructor subtree mounts the factories it shares with the admin.
