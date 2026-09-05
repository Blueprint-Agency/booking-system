"use client";
/**
 * Keeps the Clerk session's active organization matching the hostname.
 *
 * The rule lives in `active-organization.ts`; this is the wiring — read Clerk's
 * state, apply the verdict, and say whether the session has settled. It exists
 * as a hook rather than inline in `workspace-context.tsx` because the answer
 * gates the first API call: a `/portal/auth/me` sent before the organization is
 * active comes back 403, and the provider reads a 403 as "no staff row" and
 * signs the user out — the sign-in loop this whole path exists to stop.
 *
 * The status is *derived*, not stored. Everything it depends on already lives
 * in Clerk's own state, so keeping a second copy in `useState` would only add a
 * render in which the two disagree — and that render is exactly the window in
 * which the gated request would go out early. The one thing state is kept for
 * is the outcome of the switch itself, which nothing else can report.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { organizationActivation, type OrgActivation } from "./active-organization";
import { isSuperPortalHost, tenantSlugFromHost } from "./tenant-host";
import { reportError } from "./report-error";

export type OrgSyncStatus =
  /** Still reading Clerk, or a switch is in flight. Hold the first API call. */
  | "settling"
  /** The session is in the organization this hostname needs, or needs none. */
  | "ready"
  /** This account is in no organization for this studio. The backend will say
   *  so properly; nothing is gained by holding the request back. */
  | "unavailable";

/** A staff member works at a handful of studios at most; one page covers it. */
const MEMBERSHIP_PAGE_SIZE = 100;

/** How long a switch may stay in flight before the app stops waiting on it. */
const SWITCH_TIMEOUT_MS = 8_000;

export function useActiveOrganization(enabled: boolean): OrgSyncStatus {
  const { isLoaded: orgLoaded, organization } = useOrganization();
  const {
    isLoaded: listLoaded,
    setActive,
    userMemberships,
  } = useOrganizationList({ userMemberships: { pageSize: MEMBERSHIP_PAGE_SIZE } });

  const activeOrganizationId = organization?.id ?? null;
  const memberships = userMemberships.data;
  const settled = enabled && orgLoaded && listLoaded && !userMemberships.isLoading;

  const verdict = useMemo<OrgActivation | null>(() => {
    if (!settled) return null;
    // Read on the client only. During the server render there is no hostname to
    // read and nothing to activate; the effect below never runs there either.
    const host = typeof window === "undefined" ? null : window.location.host;
    return organizationActivation({
      superPortal: isSuperPortalHost(host),
      tenantSlug: tenantSlugFromHost(host),
      activeOrganizationId,
      memberships: (memberships ?? []).map(m => ({
        id: m.organization.id,
        slug: m.organization.slug,
      })),
    });
  }, [settled, activeOrganizationId, memberships]);

  /** Set when the switch did not happen — Clerk refused it, or it simply never
   *  took. Without it a failure reads as "still settling" and the gated request
   *  never goes out at all, which is a spinner that never stops. */
  const [failed, setFailed] = useState(false);
  /** What we last asked Clerk for. Without it, a switch that does not take
   *  effect would be re-asked on every render, forever. */
  const attempted = useRef<string | null>(null);

  const target =
    verdict?.kind === "clear"
      ? "none"
      : verdict?.kind === "activate"
        ? verdict.organizationId
        : null;

  useEffect(() => {
    if (!setActive || target === null) {
      attempted.current = null;
      return;
    }
    if (attempted.current === target) return;
    attempted.current = target;
    // A new target is a new attempt. Without this, one failed switch would make
    // the hook answer `unavailable` for the rest of the session — including a
    // later, legitimate activation on another studio's portal, where the gated
    // request would then go out before the claim was on the token and the user
    // would be signed out.
    setFailed(false);

    let cancelled = false;
    // The switch is over when Clerk's own state reflects it, which turns the
    // verdict into `keep` and re-runs this effect with `target` null. Anything
    // still in flight after this is not coming — give up rather than hold the
    // app on a spinner, and let the backend give the caller a real answer.
    const giveUp = setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, SWITCH_TIMEOUT_MS);

    void setActive({ organization: target === "none" ? null : target }).catch(err => {
      reportError(err, { scope: "active-organization" });
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, [setActive, target]);

  if (!enabled) return "ready";
  if (!verdict) return "settling";
  if (verdict.kind === "keep") return "ready";
  if (verdict.kind === "unavailable") return "unavailable";
  // A switch was asked for. It is in flight until Clerk's own state reflects it,
  // at which point the verdict above becomes `keep`.
  return failed ? "unavailable" : "settling";
}
