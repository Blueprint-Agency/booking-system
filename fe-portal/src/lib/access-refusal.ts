/**
 * What the backend's refusal of `/portal/auth/me` means for the person holding
 * the session.
 *
 * The distinction this file exists to hold is between **no session** and **the
 * wrong session**, because the portal used to treat them as one thing. A 403
 * meant "sign out and go to /login" — but a 403 is the answer to "may *this*
 * account be on *this* hostname", and the account it refuses is usually
 * perfectly valid somewhere else. Signing it out sent the browser to a login
 * page that handed the same session straight back, which produced the same 403:
 * a loop with nothing on screen to explain it.
 *
 * The commonest way in is by design, not accident. Clerk's cookie for the
 * portal is scoped to `*.portal.<root>`, so `admin.portal.…` (the super portal)
 * and `{slug}.portal.…` (a studio's) share one session — and platform admins
 * deliberately have no `staff_users` row at any studio, because folding them in
 * would make the first studio's superadmin an operator of every studio. So a
 * platform admin opening a studio's portal is a *supported* thing to do that
 * the backend must refuse, and the app has to say so rather than thrash.
 *
 * Not every 403 is about the account, though, and that is the second thing this
 * file is for. `tenant_suspended` is about the *studio*, and
 * `organization_required` is usually about nothing at all — a Clerk membership
 * list this tab has not caught up with. Offering "sign out and use another
 * account" to either would be advice that cannot work: the first is the same
 * for every account, and the second clears itself. So each refusal carries its
 * own words and its own way out.
 *
 * Kept pure and separate from the provider so all of that is testable without
 * mounting Clerk.
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
  // 401 is Clerk's answer, not the studio's: the token is missing, expired or
  // rejected outright. There is no account to name, so there is nothing to
  // offer but a fresh sign-in.
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
    case "organization_required":
      // Reached only once the provider's retries are spent. The cause is a
      // Clerk membership list this tab has not caught up with, which is
      // transient — so the useful button is "try again", not "sign out".
      return {
        title: "We couldn't finish signing you in",
        detail:
          "hasn't been matched to this studio yet. That usually clears on its own — try again.",
        namesAccount: true,
        offerSwitch: true,
        offerRetry: true,
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
