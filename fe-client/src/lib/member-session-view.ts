/** The session as the member app reads it. */
export interface MemberSession {
  userId: string;
  email: string;
  /** The studio stamped on the session at sign-in, when it carries one. */
  claimedTenantId: string | null;
}

import { maintenanceMessage } from "./maintenance.ts";
import { studioRefusal } from "./studio-refusal.ts";

export interface MemberSessionView {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: MemberSession | null;
  /**
   * Set only when the app could not find out whether this browser is signed
   * in: the read failed, and the browser holds a session token. Neither signed
   * in nor signed out; the page that asked throws it to the error boundary.
   */
  failure?: unknown;
}

/** Better Auth's session store, as far as the member app reads it. */
export interface SessionStoreValue {
  data: {
    user: { id: string; email: string };
    session: object;
  } | null;
  isPending: boolean;
  /**
   * The last read's failure. Better Auth keeps `data` through a failed
   * re-read and drops it only on a `401`, with the refusal's body spread into
   * the error, so only a visit's first read can fail with no `data`.
   */
  error?: unknown;
}

const UNLOADED: MemberSessionView = { isLoaded: false, isSignedIn: false, session: null };

function statusOf(err: unknown): { status: number } | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const { status } = err as { status: unknown };
  return typeof status === "number" ? { status } : null;
}

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
 *
 * A read that failed with nothing to show (#500) is told apart by what answered:
 *  - a `401`, or a browser holding no token: signed out;
 *  - a failure the app answers elsewhere (a studio refusal, maintenance): still
 *    loading, so the paused, mismatch or maintenance page draws without a
 *    sign-in page flashing beneath it;
 *  - anything else with a token held (a `5xx`, a dropped connection): unknown,
 *    carried as `failure`. The token says the member was signed in, and the app
 *    could not ask, so it must not say "nobody".
 */
export function memberSessionView(
  hydrated: boolean,
  store: SessionStoreValue,
  hasToken = false,
): MemberSessionView {
  if (!hydrated) return UNLOADED;
  const { data, isPending, error } = store;
  if (data === null && !isPending && error != null && hasToken) {
    const answer = statusOf(error);
    if (answer?.status !== 401) {
      if (
        answer &&
        (studioRefusal(answer.status, error) !== null || maintenanceMessage(answer.status, error) !== null)
      ) {
        return UNLOADED;
      }
      return { ...UNLOADED, failure: error };
    }
  }
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
