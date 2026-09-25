/**
 * A signed-in call the backend answered with 401: the member's session is gone
 * (expired, signed out elsewhere, revoked, or an impersonation grant that ran
 * out). The token this hostname holds is dead, so the app must stop acting
 * signed in — otherwise every `/me/*` read fails quietly and the member sees
 * "0 credits" and empty pages with no prompt to sign in again.
 *
 * A relay rather than a direct call into `member-auth`: `api-url.ts` is also
 * loaded server-side by `proxy.ts`, and must not pull the Better Auth client in
 * with it. `member-auth` registers the handler; the fetch helpers only notify.
 *
 * No `@/` imports, so `node --test` can load it.
 */

/** Receives the token the refused call sent, when the caller knows it. */
type Listener = (sentToken?: string) => void;

let listener: Listener | null = null;

/** Called once by `member-auth` with what an expired session should do. */
export function onSessionExpired(fn: Listener | null): void {
  listener = fn;
}

/**
 * Tell the app its session has expired when a call that carried a bearer token
 * came back 401. A 401 on an anonymous call means nothing about the session.
 * Returns whether it did.
 *
 * Pass `sentToken` where it is known: a 401 that lands after the member has
 * signed in again answers for the old token, and must not end the new session.
 */
export function noteSessionExpiry(status: number, sentBearer: boolean, sentToken?: string): boolean {
  if (status !== 401 || !sentBearer) return false;
  listener?.(sentToken);
  return true;
}

/** The bearer token a request's headers carry, if any. */
export function bearerToken(headers: Headers): string | undefined {
  return /^Bearer\s+(\S.*)$/.exec(headers.get("authorization") ?? "")?.[1];
}

/** Whether a request's headers carry a bearer token. */
export function hasBearer(headers: Headers): boolean {
  return bearerToken(headers) !== undefined;
}
