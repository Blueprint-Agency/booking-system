/**
 * Which Clerk Organization a portal session must be active in.
 *
 * A staff token proves which studio the caller is signed into by the
 * organization claim on it, and the backend refuses a portal request whose
 * claim does not name the studio the hostname asked for
 * (`services/tenants/org-claim.ts`). A session with **no** active organization
 * carries no claim at all, and is refused the same way — `organization_required`
 * — the moment the studio has an organization configured, which every studio
 * does from the minute it is provisioned.
 *
 * Nothing in this app was setting that. The claim arrived because the Clerk
 * instance had `force_organization_selection` on, so Clerk activated one for
 * every session before the app saw it. That setting had to be turned off: the
 * super portal is cross-tenant, belongs to no organization, and forcing a
 * selection there left every session stuck `pending` with nothing to select.
 * Turning it off fixed the super portal and broke every studio's portal —
 * sign in, land on `/admin`, `/portal/auth/me` answers 403, `WorkspaceProvider`
 * reads that as "no staff row", signs out, and the login page comes back.
 *
 * So the app decides instead, from the hostname it is already reading the
 * Tenant from. The two products want opposite things and both are stated here:
 * a studio's portal wants that studio's organization active, the super portal
 * wants none.
 *
 * This is a **convenience, not a gate.** Everything it can do, a signed-in user
 * could do through Clerk's own organization switcher; what a session may then
 * read is still decided by the organization claim check and Row-Level Security
 * on the backend. Activating the wrong organization cannot grant anything — it
 * produces the same 403 as activating none. That is what lets the fallback
 * below guess at all.
 */

/** One of the signed-in user's organization memberships. */
export interface OrgMembership {
  id: string;
  slug: string | null;
}

export type OrgActivation =
  /** The session is already where it should be. */
  | { kind: "keep" }
  /** Make this organization active. */
  | { kind: "activate"; organizationId: string }
  /** Leave every organization — the super portal belongs to none. */
  | { kind: "clear" }
  /** Signed in, but this account is in no organization for this studio. */
  | { kind: "unavailable" };

export function organizationActivation(input: {
  /** `admin.portal.…` — the cross-tenant super portal. */
  superPortal: boolean;
  /** The studio the hostname names, or null when it names none. */
  tenantSlug: string | null;
  /** The organization the session is active in, or null for none. */
  activeOrganizationId: string | null;
  memberships: OrgMembership[];
}): OrgActivation {
  // The super portal is cross-tenant by definition; an active organization on
  // it is a leftover from a studio the operator visited earlier, and it would
  // be sent as a claim naming that studio.
  if (input.superPortal) {
    return input.activeOrganizationId ? { kind: "clear" } : { kind: "keep" };
  }

  // No slug means no studio to be in — the bare root domain, or a preview URL.
  // Nothing is known about what should be active, so nothing is changed.
  if (!input.tenantSlug) return { kind: "keep" };

  // Provisioning names the Clerk organization with our own slug, so the match is
  // exact and survives a staff member who works at two studios.
  const bySlug = input.memberships.find(m => m.slug === input.tenantSlug);
  // A studio provisioned before that rule, or one whose slug Clerk had to
  // adjust, has an organization whose slug is not ours. One membership and no
  // slug match is unambiguous enough to try: the backend refuses it if it is
  // wrong, which is the same answer as not trying at all.
  const only = input.memberships.length === 1 ? input.memberships[0] : undefined;
  const target = bySlug ?? only;

  if (!target) return { kind: "unavailable" };
  return target.id === input.activeOrganizationId
    ? { kind: "keep" }
    : { kind: "activate", organizationId: target.id };
}
