"use client";
/**
 * The portal's sign-in form: on a studio's hostname against the `staff` Better
 * Auth pool (#115), on the super portal's against the `platform` pool (#116).
 * `lib/portal-auth.ts` already talks to the right pool; `superPortal` only
 * decides where a signed-in person is sent and a line of copy.
 *
 * Email and password, a second factor when one is enrolled, and a password
 * reset. Two things
 * read differently because the flows underneath do:
 *
 *   - **The second factor** offers the authenticator app first when one is
 *     enrolled, and an emailed code on request. Every enrolled account can be
 *     mailed a code, so preferring it would send a mail on every sign-in.
 *   - **A reset is a link, not a code.** Better Auth mails a link that comes
 *     back to this page as `?token=…`, and the new password is chosen here.
 *
 * Both portals ask for the email first, so nobody sees a password field they
 * cannot fill. On the super portal an operator who has never set a password is
 * mailed the link to set one (`be/src/services/auth/platform-first-sign-in.ts`).
 * On a studio's portal the link goes to staff with no password at this studio
 * — each studio has its own sign-in (#231) — and to staff still pending here,
 * for whom following the link accepts their invitation
 * (`be/src/services/auth/staff-sign-in-step.ts`).
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { ErrorNote } from "@/components/auth/auth-card";
import { OtpInput } from "@/components/auth/otp-input";
import { PasswordInput } from "@/components/auth/password-input";
import { ApiError, apiFetch } from "@/lib/api";
import { safeNextPath, signedInRedirectTarget } from "@/lib/auth-redirect";
import { portalHomePath } from "@/lib/super-portal";
import { portalAuth, usePortalSession } from "@/lib/portal-auth";

type SecondFactor = "totp" | "otp" | "backup";

type AuthError = { status?: number; code?: string; message?: string } | null | undefined;

type SignInStep =
  | { step: "password" }
  | { step: "set_password"; sent: boolean; retryAfterSeconds: number }
  /** A studio portal's answer: a link went out if one was owed, and the answer does not say. */
  | { step: "link_sent" };

/**
 * How long a studio portal's "check your email" waits before offering another
 * link. The backend mails at most three per address per 15 minutes, and past
 * that answers as if it had — so resends are spaced to fit inside the budget.
 */
const STAFF_RESEND_SECONDS = 5 * 60;

const noToken = async () => null;

/** A refused auth call, in words. */
function errorMessage(error: AuthError, fallback: string): string {
  if (error?.status === 429) return "Too many attempts. Wait a minute, then try again.";
  return error?.message || fallback;
}

export function PortalLogin({ superPortal }: { superPortal: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const { isLoaded, session } = usePortalSession();

  // Where to go once signed in: a safe `?next=`, or this product's home.
  const next = safeNextPath(searchParams) ?? portalHomePath(superPortal);
  // Better Auth sends a reset link back here carrying one of these.
  const resetToken = searchParams.get("token");
  const resetLinkBroken = searchParams.get("error") === "INVALID_TOKEN";

  const [view, setView] = useState<
    "signin" | "mfa" | "forgot" | "sent" | "reset" | "resetDone" | "firstSignIn" | "linkSent"
  >(resetToken ? "reset" : "signin");

  const [email, setEmail] = useState("");
  // The password field shows only once the email step says so.
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  // When the next set-password link may be asked for, as epoch ms.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<SecondFactor>("totp");
  const [methods, setMethods] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(
    resetLinkBroken ? "That reset link has expired or was already used. Ask for a new one." : null,
  );
  const [submitting, setSubmitting] = useState(false);

  // A sign-in form is for someone who is not signed in. A live session goes to
  // where it was heading; if the account has no access there, the workspace
  // says so by name. The edge cannot do this — the session is a token in this
  // page's storage — so this is the whole of the guard.
  const redirectTarget =
    session && view !== "reset"
      ? signedInRedirectTarget(pathname ?? "", searchParams, superPortal)
      : null;
  useEffect(() => {
    if (redirectTarget) router.replace(redirectTarget);
  }, [redirectTarget, router]);

  // Tick the resend countdown while one is running.
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function run(step: () => Promise<void>) {
    setError(null);
    setSubmitting(true);
    try {
      await step();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function startSecondFactor(offered: string[]) {
    setMethods(offered);
    setCode("");
    if (offered.includes("totp")) {
      setFactor("totp");
    } else {
      setFactor("otp");
      const { error: sendErr } = await portalAuth.twoFactor.sendOtp();
      if (sendErr) setError(errorMessage(sendErr, "Could not send a verification code."));
    }
    setView("mfa");
  }

  /** Ask the backend what comes after this email; mails the set-password link when owed. */
  async function askSignInStep(): Promise<SignInStep | null> {
    const body = { email: email.trim() };
    try {
      if (superPortal) {
        return await apiFetch<SignInStep>("/platform/sign-in/step", noToken, { method: "POST", body });
      }
      const { next } = await apiFetch<{ next: "password" | "link_sent" }>("/public/staff/sign-in-step", noToken, {
        method: "POST",
        body,
      });
      return next === "password" ? { step: "password" } : { step: "link_sent" };
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      // `password_link_refused`: the auth pool's own per-address budget for links, spent.
      const throttled =
        err.status === 429 || (err.body as { error?: string } | null)?.error === "password_link_refused";
      setError(
        throttled
          ? "Too many attempts. Wait a minute, then try again."
          : err.status === 400
            ? "Enter a valid email address."
            : "We couldn't continue. Please try again.",
      );
      return null;
    }
  }

  function applyLinkSentStep() {
    setNow(Date.now());
    setResendAt(Date.now() + STAFF_RESEND_SECONDS * 1000);
    setPassword("");
    setView("linkSent");
  }

  function applySetPasswordStep(result: Extract<SignInStep, { step: "set_password" }>) {
    setNow(Date.now());
    setResendAt(Date.now() + result.retryAfterSeconds * 1000);
    setPassword("");
    setView("firstSignIn");
  }

  function handleEmailStep(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await askSignInStep();
      if (!result) return;
      if (result.step === "set_password") applySetPasswordStep(result);
      else if (result.step === "link_sent") applyLinkSentStep();
      else setEmailConfirmed(true);
    });
  }

  function resendSetPasswordLink() {
    void run(async () => {
      const result = await askSignInStep();
      if (result?.step === "set_password") applySetPasswordStep(result);
      else if (result?.step === "link_sent") applyLinkSentStep();
    });
  }

  function changeEmail() {
    setEmailConfirmed(false);
    setPassword("");
    setError(null);
    setView("signin");
  }

  function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { data, error: signInErr } = await portalAuth.signIn.email({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setError(
          signInErr.status === 401
            ? "Incorrect email or password."
            : errorMessage(signInErr, "We couldn't sign you in. Please check your details and try again."),
        );
        return;
      }
      const challenge = data as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] } | null;
      if (challenge?.twoFactorRedirect) {
        await startSecondFactor(challenge.twoFactorMethods ?? []);
        return;
      }
      router.replace(next);
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const trimmed = code.trim();
      const { error: verifyErr } =
        factor === "totp"
          ? await portalAuth.twoFactor.verifyTotp({ code: trimmed })
          : factor === "otp"
            ? await portalAuth.twoFactor.verifyOtp({ code: trimmed })
            : await portalAuth.twoFactor.verifyBackupCode({ code: trimmed });
      if (verifyErr) {
        setError(errorMessage(verifyErr, "Invalid or expired verification code."));
        return;
      }
      router.replace(next);
    });
  }

  function emailMeACode() {
    void run(async () => {
      const { error: sendErr } = await portalAuth.twoFactor.sendOtp();
      if (sendErr) {
        setError(errorMessage(sendErr, "Could not send a verification code."));
        return;
      }
      setFactor("otp");
      setCode("");
    });
  }

  function switchFactor(to: SecondFactor) {
    setFactor(to);
    setCode("");
    setError(null);
  }

  function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { error: sendErr } = await portalAuth.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/login`,
      });
      if (sendErr) {
        setError(errorMessage(sendErr, "Could not send a reset link."));
        return;
      }
      setView("sent");
    });
  }

  function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!resetToken) return;
    void run(async () => {
      const { error: resetErr } = await portalAuth.resetPassword({ newPassword, token: resetToken });
      if (resetErr) {
        setError(errorMessage(resetErr, "That reset link has expired or was already used. Ask for a new one."));
        return;
      }
      // The token is spent; take it out of the address so a reload is a sign-in.
      router.replace("/login");
      setNewPassword("");
      setConfirm("");
      setView("resetDone");
    });
  }

  function backToSignIn() {
    setView("signin");
    setError(null);
  }

  // Either the redirect above is about to run, or the session has not been read
  // yet. Both are a spinner, not a form.
  if (!isLoaded || redirectTarget) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  // The before: box stretches each text link's hit area to thumb height
  // without moving anything around it.
  const linkButton =
    "relative font-medium text-accent hover:text-accent-deep before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']";

  if (view === "mfa") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Verify your sign in</h1>
        <p className="mb-5 break-words text-sm text-muted">
          {factor === "totp"
            ? "Enter the code from your authenticator app."
            : factor === "backup"
              ? "Enter one of your backup codes."
              : `We sent a verification code to ${email.trim()}.`}
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Verification code</Label>
            {factor === "backup" ? (
              <Input value={code} onChange={ev => setCode(ev.target.value)} autoFocus autoComplete="one-time-code" />
            ) : (
              <OtpInput value={code} onChange={setCode} autoFocus />
            )}
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify and continue
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-3 text-sm">
          {methods.includes("otp") && (
            <button type="button" onClick={emailMeACode} disabled={submitting} className={linkButton}>
              {factor === "otp" ? "Resend code" : "Email me a code"}
            </button>
          )}
          {methods.includes("totp") && factor !== "backup" && (
            <button type="button" onClick={() => switchFactor("backup")} className={linkButton}>
              Use backup code
            </button>
          )}
          {methods.includes("totp") && factor !== "totp" && (
            <button type="button" onClick={() => switchFactor("totp")} className={linkButton}>
              Use authenticator app
            </button>
          )}
        </div>
      </>
    );
  }

  if (view === "forgot") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Reset your password</h1>
        <p className="mb-5 break-words text-sm text-muted">
          Enter your email and we&apos;ll send you a link to choose a new password.
        </p>
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={ev => setEmail(ev.target.value)}
            />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
        <button type="button" onClick={backToSignIn} className={`mt-4 text-sm ${linkButton}`}>
          Back to sign in
        </button>
      </>
    );
  }

  if (view === "sent") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Check your email</h1>
        <p className="mb-5 break-words text-sm text-muted">
          If {email.trim()} has {superPortal ? "an operator" : "a staff"} account here, a link to choose a new password is on its way.
          It works once, for one hour.
        </p>
        <button type="button" onClick={backToSignIn} className={`text-sm ${linkButton}`}>
          Back to sign in
        </button>
      </>
    );
  }

  if (view === "reset") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Choose a new password</h1>
        <p className="mb-5 break-words text-sm text-muted">You&apos;ll sign in with it next.</p>
        <form onSubmit={handleReset} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={ev => setNewPassword(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={ev => setConfirm(ev.target.value)}
            />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Set password
          </Button>
        </form>
      </>
    );
  }

  const passwordField = (
    <div className="space-y-1.5">
      <Label htmlFor="password">Password</Label>
      <PasswordInput
        id="password"
        autoComplete="current-password"
        value={password}
        onChange={ev => setPassword(ev.target.value)}
        autoFocus
      />
    </div>
  );

  if (view === "linkSent") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Check your email</h1>
        <p className="mb-5 break-words text-sm text-muted">
          If {email.trim()} can sign in here, we sent it a link to set your password. It works once, for one hour.
          Once your password is set, you&apos;re in.
        </p>
        {error && <ErrorNote message={error} />}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            onClick={resendSetPasswordLink}
            disabled={submitting || resendIn > 0}
            className={`${linkButton} disabled:cursor-not-allowed disabled:text-muted`}
          >
            {resendIn > 0 ? `Resend link in ${resendIn}s` : "Didn't get it? Resend link"}
          </button>
          <button type="button" onClick={changeEmail} className={linkButton}>
            Use a different email
          </button>
        </div>
      </>
    );
  }

  if (view === "firstSignIn") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Check your email</h1>
        <p className="mb-5 break-words text-sm text-muted">
          This is your first sign-in. We sent a link to {email.trim()} to set your password. It works once, for
          one hour. Once your password is set, sign in with it here.
        </p>
        <form onSubmit={handleSignIn} className="space-y-4">
          {passwordField}
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            onClick={resendSetPasswordLink}
            disabled={submitting || resendIn > 0}
            className={`${linkButton} disabled:cursor-not-allowed disabled:text-muted`}
          >
            {resendIn > 0 ? `Resend link in ${resendIn}s` : "Didn't get it? Resend link"}
          </button>
          <button type="button" onClick={changeEmail} className={linkButton}>
            Use a different email
          </button>
        </div>
      </>
    );
  }

  // The first screen: the email alone.
  if (!emailConfirmed) {
    return (
      <>
        <h1 className="mb-5 text-lg font-semibold text-ink">
          {view === "resetDone" ? "Password updated — sign in" : "Welcome back"}
        </h1>
        <form onSubmit={handleEmailStep} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={ev => setEmail(ev.target.value)}
            />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-5 text-lg font-semibold text-ink">
        {view === "resetDone" ? "Password updated — sign in" : "Welcome back"}
      </h1>
      <form onSubmit={handleSignIn} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly
          />
        </div>
        {passwordField}
        {error && <ErrorNote message={error} />}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
      <button type="button" onClick={changeEmail} className={`mt-4 mr-4 text-sm ${linkButton}`}>
        Use a different email
      </button>
      <button
        type="button"
        onClick={() => {
          setView("forgot");
          setError(null);
        }}
        className={`mt-4 text-sm ${linkButton}`}
      >
        Forgot password?
      </button>
      <p className="mt-6 text-xs text-muted">
        Staff accounts are invite-only. Ask an admin if you don&apos;t have one yet.
      </p>
    </>
  );
}
