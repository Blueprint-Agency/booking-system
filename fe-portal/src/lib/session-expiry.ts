/**
 * A signed-in call the backend answered with 401: the portal session is gone
 * (expired, signed out elsewhere, revoked, or ended when the account was
 * archived). The token this hostname holds is dead, so the portal must stop
 * acting signed in. Otherwise every read fails and a screen has only a failure
 * to show, with no way back to the sign-in page.
 *
 * It covers a studio's portal and the super portal alike: both shells read the
 * session store, and a signed-out session sends them to `/login?next=…`
 * (`workspace-context.tsx`, `components/platform/platform-shell.tsx`). This is
 * what makes a `401` "answered elsewhere" in `failed-read.ts`.
 *
 * A relay rather than a direct call into `portal-auth`: `portal-auth` pulls the
 * Better Auth client in. `portal-auth` registers the handler; the fetch helper
 * only notifies. fe-client keeps its own copy (the apps share no code).
 *
 * No `@/` imports, so `node --test` can load it.
 */

/** Receives the token the refused call sent, when the caller knows it. */
type Listener = (sentToken?: string) => void;

let listener: Listener | null = null;

/** Called once by `portal-auth` with what an expired session should do. */
export function onSessionExpired(fn: Listener | null): void {
  listener = fn;
}

/**
 * Tell the app its session has expired when a call that carried a bearer token
 * came back 401. A 401 on an anonymous call means nothing about the session.
 * Returns whether it did.
 *
 * Pass `sentToken` where it is known: a 401 that lands after the person has
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
