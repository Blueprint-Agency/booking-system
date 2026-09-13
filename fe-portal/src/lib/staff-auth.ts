"use client";
/**
 * The studio portal's session: a Better Auth `staff` pool session, held as a
 * bearer token (#115).
 *
 * **A bearer token, per origin.** The API is on another host, so a session
 * cookie would be the API's, shared by every studio's portal in the browser —
 * exactly the "signed in at A, therefore at B" the per-studio session claim
 * exists to rule out. So every call here goes out with `credentials: "omit"`,
 * the token comes back in `set-auth-token`, and it is kept in this hostname's
 * own `localStorage`. Studio B's portal never holds studio A's token; the super
 * portal (Clerk, until #116) never holds either.
 *
 * **The second factor rides a header too.** A correct password that owes one
 * leaves a short-lived challenge the verify step needs; the backend hands it
 * back in `set-two-factor-challenge` rather than as a cookie
 * (`be/src/services/auth/two-factor-challenge.ts`), and it is kept in memory
 * only, for the length of the sign-in.
 *
 * Every call names its studio with `X-Tenant-Slug`: the backend runs the staff
 * pool inside the Tenant the hostname resolved to, and stamps a new session
 * with it.
 */
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { getApiBaseUrl } from "@/lib/api-url";
import { tenantRequestHeaders } from "@/lib/tenant-host";

/** Where this hostname keeps its staff session token. */
const TOKEN_KEY = "rt.staff.session";

const TOKEN_HEADER = "set-auth-token";
const CHALLENGE_RESPONSE_HEADER = "set-two-factor-challenge";
const CHALLENGE_REQUEST_HEADER = "X-Two-Factor-Challenge";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage blocked (a locked-down browser profile): no session survives a
    // reload, but signing in still works for the life of the tab.
    return null;
  }
}

let memoryToken: string | null = null;
let challenge: string | null = null;

/** The staff session token this hostname holds, or null when signed out. */
export function readStaffToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? memoryToken;
}

function storeStaffToken(token: string | null) {
  memoryToken = token;
  const store = storage();
  if (!store) return;
  if (token) store.setItem(TOKEN_KEY, token);
  else store.removeItem(TOKEN_KEY);
}

/** The `getToken` the portal's API client takes (`lib/api.ts`). */
export async function getStaffToken(): Promise<string | null> {
  return readStaffToken();
}

export const staffAuth = createAuthClient({
  baseURL: `${getApiBaseUrl()}/auth/staff`,
  fetchOptions: {
    credentials: "omit",
    auth: { type: "Bearer", token: () => readStaffToken() ?? undefined },
    onRequest: context => {
      for (const [name, value] of Object.entries(tenantRequestHeaders())) {
        context.headers.set(name, value);
      }
      if (challenge) context.headers.set(CHALLENGE_REQUEST_HEADER, challenge);
      return context;
    },
    onResponse: ({ response }) => {
      const token = response.headers.get(TOKEN_HEADER);
      if (token) {
        storeStaffToken(token);
        // A session exists now, so whatever challenge led here is spent.
        challenge = null;
      }
      const issued = response.headers.get(CHALLENGE_RESPONSE_HEADER);
      if (issued) {
        challenge = issued;
        // A challenge means there is no session yet, so any token still held is
        // a dead one — and the backend ignores a challenge sent beside a token.
        storeStaffToken(null);
      }
    },
  },
  plugins: [twoFactorClient()],
});

/**
 * Sign out: end the session on the backend, and forget the token whatever the
 * backend said — a sign-out that fails offline must still leave this browser
 * signed out, or the button does nothing and the next person inherits the desk.
 */
export async function signOutStaff(): Promise<void> {
  try {
    await staffAuth.signOut();
  } finally {
    storeStaffToken(null);
    challenge = null;
    // The session atom re-reads on sign-out, but only when the call succeeded.
    staffAuth.$store.notify("$sessionSignal");
  }
}

/** The staff session as the portal reads it. */
export interface StaffSession {
  email: string;
  name: string;
  /** The studio stamped on the session at sign-in (`session-tenant.ts`). */
  claimedTenantId: string | null;
}

/**
 * The signed-in staff session, from Better Auth's own session store.
 *
 * `isLoaded` is false until the first answer arrives, and stays true across
 * the background re-reads that follow (focus, sign-in, sign-out) so the app is
 * not torn down into a spinner every time the tab regains focus.
 */
export function useStaffSession(): {
  isLoaded: boolean;
  session: StaffSession | null;
} {
  const { data, isPending } = staffAuth.useSession();
  const session = data
    ? {
        email: data.user.email,
        name: data.user.name,
        claimedTenantId:
          (data.session as { claimedTenantId?: string | null }).claimedTenantId ?? null,
      }
    : null;
  return { isLoaded: !isPending || data !== null, session };
}
