"use client";
/**
 * The member's session: a Better Auth session from the `client` pool (#117),
 * held as a bearer token.
 *
 * **A bearer token, per origin.** The API is on another host, so a session
 * cookie would be the API's, shared by every studio's member app in the browser
 * — exactly the "signed in at A, therefore at B" the per-studio session claim
 * exists to rule out. So every call here goes out with `credentials: "omit"`,
 * the token comes back in `set-auth-token`, and it is kept in this hostname's
 * own `localStorage`. Studio B's app never holds studio A's token.
 *
 * Every call names its studio with `X-Tenant-Slug`: the backend runs the pool
 * inside the Tenant the hostname resolved to, mails the code in that studio's
 * name and stamps the new session with it.
 *
 * Nothing here gates a page. The edge never sees the token, so the pages that
 * need a member (the account shell, checkout) ask `useMemberSession` and send a
 * signed-out visitor to `/login`.
 */
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { getApiBaseUrl } from "@/lib/api-url";
import { onSessionExpired } from "@/lib/session-expiry";
import { clearTelemetryUser } from "@/lib/telemetry";
import { tenantRequestHeaders } from "@/lib/tenant-host";

/** Where this hostname keeps its session token. */
const TOKEN_KEY = "rt.client.session";
const TOKEN_HEADER = "set-auth-token";

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

/** The session token this hostname holds, or null when signed out. */
export function readMemberToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? memoryToken;
}

function storeMemberToken(token: string | null) {
  memoryToken = token;
  const store = storage();
  if (!store) return;
  if (token) store.setItem(TOKEN_KEY, token);
  else store.removeItem(TOKEN_KEY);
}

/** The `getToken` the member API client takes (`lib/api.ts`). */
export async function getMemberToken(): Promise<string | null> {
  return readMemberToken();
}

export const memberAuth = createAuthClient({
  baseURL: `${getApiBaseUrl()}/auth/client`,
  fetchOptions: {
    credentials: "omit",
    auth: { type: "Bearer", token: () => readMemberToken() ?? undefined },
    onRequest: (context) => {
      for (const [name, value] of Object.entries(tenantRequestHeaders())) {
        context.headers.set(name, value);
      }
      return context;
    },
    onResponse: ({ response }) => {
      const token = response.headers.get(TOKEN_HEADER);
      if (token) storeMemberToken(token);
    },
  },
  plugins: [emailOTPClient()],
});

/**
 * Adopt a session issued outside the auth client — registration answers with
 * one (`POST /public/members/register`) — and tell the session store about it.
 */
export function adoptMemberSession(token: string): void {
  storeMemberToken(token);
  memberAuth.$store.notify("$sessionSignal");
}

/**
 * Sign out: end the session on the backend, and forget the token whatever the
 * backend said — a sign-out that fails offline must still leave this browser
 * signed out.
 */
export async function signOutMember(): Promise<void> {
  try {
    await memberAuth.signOut();
  } finally {
    storeMemberToken(null);
    clearTelemetryUser();
    // The session atom re-reads on sign-out, but only when the call succeeded.
    memberAuth.$store.notify("$sessionSignal");
  }
}

/**
 * The backend refused this hostname's token (a 401 on a signed-in call): the
 * session is already gone on its side, so there is nothing to sign out of.
 * Forget the token and let the session store re-read — the member reads as
 * signed out, and the pages that need one send them to `/login`.
 */
export function handleExpiredSession(sentToken?: string): void {
  const current = readMemberToken();
  if (!current) return;
  // A late 401 for a token this browser has since replaced (the member signed
  // in again while it was in flight) says nothing about the new session.
  if (sentToken !== undefined && sentToken !== current) return;
  storeMemberToken(null);
  clearTelemetryUser();
  memberAuth.$store.notify("$sessionSignal");
}

onSessionExpired(handleExpiredSession);

/** The session as the member app reads it. */
export interface MemberSession {
  userId: string;
  email: string;
  /** The studio stamped on the session at sign-in, when it carries one. */
  claimedTenantId: string | null;
}

/**
 * The signed-in session, from Better Auth's own session store.
 *
 * `isLoaded` is false until the first answer arrives, and stays true across the
 * background re-reads that follow (focus, sign-in, sign-out) so pages are not
 * torn down into a spinner every time the tab regains focus.
 */
export function useMemberSession(): {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: MemberSession | null;
} {
  const { data, isPending } = memberAuth.useSession();
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
