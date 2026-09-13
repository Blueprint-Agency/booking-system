/**
 * What the backend's refusal of `/portal/auth/me` means for the person holding
 * the session.
 *
 * The distinction this file exists to hold is between **no session** and **the
 * wrong session**, because the portal used to treat them as one thing. A 403
 * meant "sign out and go to /login" — but a 403 is the answer to "may *this*
 * account be on *this* hostname", and the account it refuses is usually a real
 * one with a real reason to exist: invited and not yet active, staff at another
 * studio, or a studio's own staff while the studio is suspended. Signing it out
 * without a word sent the person to a login page with nothing on screen to
 * explain why they were back there.
 *
 * Not every 403 is about the account, though, and that is the second thing this
 * file is for. `tenant_suspended` is about the *studio*: offering "sign out and
 * use another account" would be advice that cannot work, since it is the same
 * for every account. So each refusal carries its own words and its own way out.
 *
 * The session itself is a Better Auth staff session, stamped with the studio it
 * signed in at (`session-tenant.ts`). Kept pure and separate from the provider
 * so all of this is testable without a session at all.
 */

/** The `error` code on a refusal body, when there is one. */
export function refusalCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

export type AuthFailure =
  /** No usable session: sign out and ask for one. */
  | { kind: "sign-out" }
  /** A real session, refused here: explain it and offer the way out. */
  | { kind: "denied"; reason: string | null }
  /** Not an auth answer at all — network, or the backend is unwell. */
  | { kind: "other" };

/**
 * How the provider should answer a failed `/portal/auth/me`.
 *
 * `status` and `body` come straight off `ApiError`; anything that is not an
 * `ApiError` is `other` and should be reported, not acted on.
 */
export function authFailure(status: number | null, body: unknown): AuthFailure {
  // 401 is the session's answer, not the studio's: the token is missing, was
  // signed out elsewhere, expired, or ended when the account was archived. There
  // is no account to name, so there is nothing to offer but a fresh sign-in.
  if (status === 401) return { kind: "sign-out" };
  if (status === 403) return { kind: "denied", reason: refusalCode(body) };
  return { kind: "other" };
}

export interface AccessDeniedCopy {
  title: string;
  /**
   * When `namesAccount`, this completes "You're signed in as <email>, which
   * …". Otherwise it stands alone, because the account is beside the point.
   */
  detail: string;
  namesAccount: boolean;
  /** Whether signing in as someone else could plausibly help. */
  offerSwitch: boolean;
  /** Whether simply asking again could plausibly help. */
  offerRetry: boolean;
}

/** A refusal code, in words the person reading it can act on. */
export function accessDeniedCopy(reason: string | null): AccessDeniedCopy {
  switch (reason) {
    case "tenant_suspended":
      // Nothing about the session is wrong, and every one of this studio's
      // staff sees it. Telling them to try another account would be advice
      // that cannot work, so this is the one case that offers no switch.
      return {
        title: "This studio is closed right now",
        detail:
          "The studio's account is suspended, so its staff portal is shut. The platform team has to reopen it — signing in as someone else won't change that.",
        namesAccount: false,
        offerSwitch: false,
        offerRetry: true,
      };
    case "tenant_required":
      // A session that names no studio. The backend never issues one on the
      // staff pool, so the only way here is a session from before that rule or
      // from somewhere it should not have come from — a fresh sign-in on this
      // hostname is the fix, and trying again with the same one is not.
      return {
        title: "We couldn't finish signing you in",
        detail:
          "isn't signed in to this studio. Sign out and sign in again here.",
        namesAccount: true,
        offerSwitch: true,
        offerRetry: false,
      };
    case "staff_inactive":
      return {
        title: "This account isn't active here",
        detail:
          "has a staff account at this studio that isn't active yet. A studio admin can activate it.",
        namesAccount: true,
        offerSwitch: true,
        offerRetry: false,
      };
    case "tenant_mismatch":
      return {
        title: "This account has no access here",
        detail: "belongs to a different studio.",
        namesAccount: true,
        offerSwitch: true,
        offerRetry: false,
      };
    default:
      // `staff_not_provisioned`, and anything the backend adds later. A wrong
      // guess at a newer code would read worse than the honest general case.
      return {
        title: "This account has no access here",
        detail:
          "isn't a staff member of this studio. If it's the right account, ask a studio admin to invite it.",
        namesAccount: true,
        offerSwitch: true,
        offerRetry: false,
      };
  }
}
