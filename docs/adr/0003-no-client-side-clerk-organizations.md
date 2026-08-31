# Members are not Clerk Organization members

**Status**: accepted (2026-08-31). Resolves issue #73, under parent #55. Spans the backend and
both frontends' auth model, which is why it lives in the root `docs/adr/` rather than in
`be/docs/adr/`. Amends ADR 0002's account of how a request proves which Tenant it is about.

A Tenant has **one** Clerk Organization, in the **portal** (staff) application. The **client**
(member) application has none: `tenants.clerk_client_org_id` is null on every studio and stays
null. Members are scoped by hostname + `Origin`, and fenced by Row-Level Security.

## The problem

`services/tenants/org-claim.ts` enforces the organization claim on both applications. The rule is
deliberately one-way: the moment a Tenant's organization id is written to its row, a token without
the claim stops working for it. That is the right rollout seam for staff. Applied to members it
broke in two places at once.

**Membership does not scale to members.** A studio has hundreds of students and Clerk prices
organization membership per seat — the client production instance was capped at *Limited
membership: 20*. Unlimited membership is a paid add-on, so this was a recurring per-studio cost,
not a toggle.

**Nothing joined the organization.** There is no `createOrganizationMembership` call anywhere in
`be/`, and self-serve organization creation is off (correctly — a student must not be able to
create a studio). With *Membership required* set, a new member signed up, belonged to no
organization, and could not create one. A dead end, and not a production-only one: both
development instances had `force_organization_selection: true` as well.

## The decision

Drop organizations on the client side. Provisioning creates the portal organization only
(`withProvisionedOrg`), and `clerk_client_org_id` is never written. Migration `0037` nulls the
values already stored, because a leftover id is exactly the state that refuses every member of
that studio with `organization_required`.

### What proves the Tenant for a member request, without the claim

- **`Origin`, from the browser.** Under the subdomain scheme the origin *contains* the Tenant
  (`https://acme.reservetoday.app`), a page cannot lie about it, and `resolveTenant` refuses an
  `X-Tenant-Slug` that disagrees with it. This is also what sets `tenantCorroborated`, which is
  the gate on the one member write that a forged header could otherwise turn into a membership at
  a studio nobody was invited to.
- **Row-Level Security.** Every read runs inside `withTenant`, so a member row belonging to
  another studio is unreachable rather than merely filtered.
- **The dedicated Clerk application.** A staff token cannot authenticate against `/me/*` at all —
  `verifyClientToken` uses the client application's JWKS.

### What is lost

The signed statement of tenancy on member requests. `Origin` is set by the browser and is strong
against a page, but it is not a signature: a non-browser caller sends whatever it likes, and for
those requests the header stands on its own. That is why `tenantCorroborated` gates writes and
RLS fences reads — the claim was defence in depth, and the depth beneath it is what remains.

## What was rejected

**Auto-join every member.** The backend would call `createOrganizationMembership` on signup and
keep the claim on both sides. It needs the unlimited-membership add-on on the client production
instance, forever, for a check that duplicates what `Origin` and RLS already do for members. If
the pricing changes, this is reversible: the column and `resolveTenantByClerkOrg('client', …)`
are both still there, unused, precisely so that reversal is a backfill and not a schema change.

## Clerk dashboard settings this decision requires

Set on **both** client instances (development and production); the portal instances are unchanged
and keep organizations exactly as they are.

| Setting | Client (member) app | Portal (staff) app |
|---|---|---|
| Organizations | may stay enabled, but unused | enabled |
| Membership required (`force_organization_selection`) | **off** | on |
| Self-serve organization creation | off | off |
| Membership limit | irrelevant — no members join | 20 is ample |

*Membership required* being off on the client side is the half that ends the signup dead end, and
it is the one thing here that no deploy can do.
