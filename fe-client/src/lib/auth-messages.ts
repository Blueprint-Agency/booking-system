/**
 * A refused member auth call, in words.
 *
 * Two shapes arrive here and are read the same way: Better Auth's own answers
 * (`{ code, message }`, from the sign-in and code requests) and the backend's
 * (`{ error }`, from registration and the member routes). The session hook's
 * `client_blocked` comes back as a Better Auth `message`.
 *
 * Pure, so it is testable without a browser. A code it does not know gets the
 * caller's fallback rather than the raw string — a member should never read
 * `internal_error`.
 */
export type MemberAuthError =
  | { status?: number; code?: string; message?: string; error?: string }
  | null
  | undefined;

export function memberAuthMessage(error: MemberAuthError, fallback: string): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";

  const reason = (error.error ?? error.code ?? error.message ?? "").toLowerCase();
  switch (reason) {
    case "client_blocked":
      return "This account can't sign in here. Please contact the studio.";
    case "invalid_otp":
      return "That code is incorrect. Check the email and try again.";
    case "otp_expired":
      return "That code has expired. Ask for a new one.";
    case "too_many_attempts":
      return "Too many wrong codes. Ask for a new code.";
    case "already_member":
      return "You already have an account here. Sign in instead.";
    case "tenant_mismatch":
      return "You're signed in at another studio. Sign out, then sign in here.";
    default:
      return fallback;
  }
}
