/** The session as the member app reads it. */
export interface MemberSession {
  userId: string;
  email: string;
  /** The studio stamped on the session at sign-in, when it carries one. */
  claimedTenantId: string | null;
}

export interface MemberSessionView {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: MemberSession | null;
}

/** Better Auth's session store, as far as the member app reads it. */
export interface SessionStoreValue {
  data: {
    user: { id: string; email: string };
    session: object;
  } | null;
  isPending: boolean;
}

const UNLOADED: MemberSessionView = { isLoaded: false, isSignedIn: false, session: null };

/**
 * What `useMemberSession` reports for the store's value.
 *
 * Before hydration it is always "not loaded yet", whatever the store holds. The
 * server has no token, so it renders every session-dependent page in its
 * loading state; Better Auth's `useStore` hands React the live store value as
 * the server snapshot too, so a store that settled before hydration (no token
 * in this browser: signed out at once) would otherwise draw the signed-out page
 * over the server's loading one — a hydration mismatch.
 *
 * After hydration, `isLoaded` is false only until the first answer arrives, and
 * stays true across the background re-reads that follow (focus, sign-in,
 * sign-out) so pages are not torn down into a spinner every time the tab
 * regains focus.
 */
export function memberSessionView(hydrated: boolean, store: SessionStoreValue): MemberSessionView {
  if (!hydrated) return UNLOADED;
  const { data, isPending } = store;
  const session = data
    ? {
        userId: data.user.id,
        email: data.user.email,
        claimedTenantId:
          (data.session as { claimedTenantId?: string | null }).claimedTenantId ?? null,
      }
    : null;
  return { isLoaded: !isPending || data !== null, isSignedIn: session !== null, session };
}
