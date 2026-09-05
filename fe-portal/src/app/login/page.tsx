"use client";
import { Suspense, useState } from "react";
import { useClerk, useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { PasswordInput } from "@/components/auth/password-input";
import { OtpInput } from "@/components/auth/otp-input";
import { StudioMark } from "@/components/brand/studio-mark";
import { portalHomePath } from "@/lib/super-portal";
import { isSuperPortalHost } from "@/lib/tenant-host";

// Unexpected throw → readable message.
function clerkErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
    longMessage?: string;
    message?: string;
  };
  const first = e?.errors?.[0];
  return (
    first?.longMessage ??
    first?.message ??
    e?.longMessage ??
    e?.message ??
    first?.code ??
    e?.code ??
    "We couldn't sign you in. Please check your details and try again."
  );
}
// Returned `{ error }` from a future-API call → readable message.
function clerkApiError(
  err: { code?: string; message?: string } | null | undefined,
): string | null {
  if (!err) return null;
  return err.message ?? "We couldn't sign you in. Please check your details and try again.";
}

function isAlreadySignedInError(err: unknown): boolean {
  const errors = (err as { errors?: Array<{ code?: string; message?: string }> })?.errors ?? [err as { code?: string; message?: string }];
  return errors.some((e) => {
    const code = String(e?.code ?? "").toLowerCase();
    const message = String(e?.message ?? "").toLowerCase();
    return (
      code.includes("session_exists") ||
      code.includes("already_signed") ||
      /already.*sign(ed)? in/.test(message) ||
      /sign(ed)? in.*already/.test(message) ||
      /already.*logged in/.test(message)
    );
  });
}

type MfaStrategy = "email_code" | "phone_code" | "totp" | "backup_code";
type SecondFactor = {
  safeIdentifier?: string;
  strategy: string;
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <StudioMark size="auth" badge="Staff" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
      {message}
    </p>
  );
}

function LoginContent() {
  const { signIn } = useSignIn();
  const { setActive } = useClerk();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only honour internal paths — never an absolute/protocol-relative URL — so a
  // crafted ?next= can't turn the login into an open redirect.
  const rawNext = searchParams?.get("next");
  // The fallback is the hostname's own home. `/admin` is a studio route that
  // does not exist on the super portal, so a fixed default would land a
  // superadmin outside the app they just signed in to.
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : portalHomePath(
          typeof window !== "undefined" && isSuperPortalHost(window.location.host),
        );

  const [view, setView] = useState<"signin" | "forgot" | "reset" | "mfa">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaStrategy, setMfaStrategy] = useState<MfaStrategy | null>(null);
  const [mfaTarget, setMfaTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function runAuthStep<T extends { error: { code?: string; message?: string } | null }>(
    step: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await step();
      if (!result.error || !isAlreadySignedInError(result.error)) return result;
      await setActive({ session: null });
      return step();
    } catch (err) {
      if (!isAlreadySignedInError(err)) throw err;
      await setActive({ session: null });
      return step();
    }
  }

  function navigateAfterAuth(destination: string) {
    return async ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
      const url = decorateUrl(destination);
      if (/^https?:\/\//i.test(url)) {
        window.location.href = url;
        return;
      }
      router.push(url);
    };
  }

  function findSecondFactor(strategy: MfaStrategy): SecondFactor | null {
    return (
      (signIn?.supportedSecondFactors as SecondFactor[] | undefined)?.find(
        factor => factor.strategy === strategy,
      ) ?? null
    );
  }

  function preferredSecondFactor(): SecondFactor | null {
    const factors = (signIn?.supportedSecondFactors as SecondFactor[] | undefined) ?? [];
    return (
      factors.find(factor => factor.strategy === "email_code") ??
      factors.find(factor => factor.strategy === "phone_code") ??
      factors.find(factor => factor.strategy === "totp") ??
      factors.find(factor => factor.strategy === "backup_code") ??
      null
    );
  }

  function signInStatusMessage(status: string | null | undefined) {
    switch (status) {
      case "needs_second_factor":
        return "Additional verification is required to complete sign in.";
      case "needs_new_password":
        return "This account requires a new password. Use the password reset flow to continue.";
      case "needs_client_trust":
        return "This browser needs an additional security check. Refresh the page and try again.";
      case "needs_first_factor":
      case "needs_identifier":
        return "Please check your email and password, then try again.";
      default:
        return "Could not complete sign in.";
    }
  }

  async function beginSecondFactor() {
    if (!signIn) return false;
    const factor = preferredSecondFactor();
    if (!factor) {
      setError("Additional verification is required, but no supported verification method is available.");
      return false;
    }

    if (factor.strategy === "email_code") {
      const { error: sendErr } = await signIn.mfa.sendEmailCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not send verification code.");
        return false;
      }
    } else if (factor.strategy === "phone_code") {
      const { error: sendErr } = await signIn.mfa.sendPhoneCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not send verification code.");
        return false;
      }
    }

    setMfaStrategy(factor.strategy as MfaStrategy);
    setMfaTarget(factor.safeIdentifier ?? null);
    setMfaCode("");
    setView("mfa");
    return true;
  }

  async function completeSignIn() {
    if (!signIn) return false;
    if (signIn.status === "needs_second_factor") {
      return beginSecondFactor();
    }
    if (signIn.status !== "complete") {
      setError(signInStatusMessage(signIn.status));
      return false;
    }

    const { error: finalErr } = await signIn.finalize({
      navigate: navigateAfterAuth(next),
    });
    if (finalErr) {
      setError(clerkApiError(finalErr) ?? "Could not complete sign in.");
      return false;
    }
    return true;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signIn) return;

    setSubmitting(true);
    try {
      const { error: createErr } = await runAuthStep(() => signIn.create({ identifier: email.trim() }));
      if (createErr) {
        setError(clerkApiError(createErr) ?? "Could not sign in.");
        return;
      }
      const { error: pwErr } = await signIn.password({
        password,
        identifier: email.trim(),
      });
      if (pwErr) {
        setError(clerkApiError(pwErr) ?? "Incorrect email or password.");
        return;
      }
      await completeSignIn();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signIn) return;

    setSubmitting(true);
    try {
      const { error: createErr } = await runAuthStep(() => signIn.create({ identifier: email.trim() }));
      if (createErr) {
        setError(clerkApiError(createErr) ?? "Could not find that account.");
        return;
      }
      const { error: sendErr } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not send reset code.");
        return;
      }
      setView("reset");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!signIn) return;

    setSubmitting(true);
    try {
      const { error: verifyErr } = await signIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      if (verifyErr) {
        setError(clerkApiError(verifyErr) ?? "Invalid or expired code.");
        return;
      }
      const { error: submitErr } = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
      });
      if (submitErr) {
        setError(clerkApiError(submitErr) ?? "Could not reset password.");
        return;
      }
      await completeSignIn();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    if (!signIn) return;
    try {
      const { error: sendErr } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendErr) setError(clerkApiError(sendErr) ?? "Could not resend code.");
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signIn || !mfaStrategy) return;

    setSubmitting(true);
    try {
      const trimmedCode = mfaCode.trim();
      const { error: verifyErr } =
        mfaStrategy === "email_code"
          ? await signIn.mfa.verifyEmailCode({ code: trimmedCode })
          : mfaStrategy === "phone_code"
            ? await signIn.mfa.verifyPhoneCode({ code: trimmedCode })
            : mfaStrategy === "totp"
              ? await signIn.mfa.verifyTOTP({ code: trimmedCode })
              : await signIn.mfa.verifyBackupCode({ code: trimmedCode });

      if (verifyErr) {
        setError(clerkApiError(verifyErr) ?? "Invalid or expired verification code.");
        return;
      }

      await completeSignIn();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaResend() {
    setError(null);
    if (!signIn || !mfaStrategy) return;
    try {
      if (mfaStrategy === "email_code") {
        const { error: sendErr } = await signIn.mfa.sendEmailCode();
        if (sendErr) setError(clerkApiError(sendErr) ?? "Could not resend code.");
      } else if (mfaStrategy === "phone_code") {
        const { error: sendErr } = await signIn.mfa.sendPhoneCode();
        if (sendErr) setError(clerkApiError(sendErr) ?? "Could not resend code.");
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  }

  function switchMfaStrategy(strategy: MfaStrategy) {
    const factor = findSecondFactor(strategy);
    if (!factor) return;
    setMfaStrategy(strategy);
    setMfaTarget(factor.safeIdentifier ?? null);
    setMfaCode("");
    setError(null);
  }

  if (view === "mfa") {
    const canResend = mfaStrategy === "email_code" || mfaStrategy === "phone_code";
    const hasBackup = Boolean(findSecondFactor("backup_code"));
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Verify your sign in</h1>
        <p className="mb-5 text-sm text-muted">
          {mfaStrategy === "totp"
            ? "Enter the code from your authenticator app."
            : mfaStrategy === "backup_code"
              ? "Enter one of your backup codes."
              : `We sent a verification code${mfaTarget ? ` to ${mfaTarget}` : ""}.`}
        </p>
        <form onSubmit={handleMfaVerify} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Verification code</Label>
            <OtpInput value={mfaCode} onChange={setMfaCode} autoFocus />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify and continue
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {canResend && (
            <button
              type="button"
              onClick={handleMfaResend}
              className="font-medium text-accent hover:text-accent-deep"
            >
              Resend code
            </button>
          )}
          {hasBackup && mfaStrategy !== "backup_code" && (
            <button
              type="button"
              onClick={() => switchMfaStrategy("backup_code")}
              className="font-medium text-accent hover:text-accent-deep"
            >
              Use backup code
            </button>
          )}
          {findSecondFactor("totp") && mfaStrategy !== "totp" && (
            <button
              type="button"
              onClick={() => switchMfaStrategy("totp")}
              className="font-medium text-accent hover:text-accent-deep"
            >
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
        <p className="mb-5 text-sm text-muted">
          Enter your email and we&apos;ll send you a reset code.
        </p>
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Send reset code
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setView("signin");
            setError(null);
          }}
          className="mt-4 text-sm font-medium text-accent hover:text-accent-deep"
        >
          Back to sign in
        </button>
      </>
    );
  }

  if (view === "reset") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-ink">Enter reset code</h1>
        <p className="mb-5 text-sm text-muted">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleReset} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Verification code</Label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(ev) => setNewPassword(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(ev) => setConfirm(ev.target.value)}
            />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset password & sign in
          </Button>
        </form>
        <button
          type="button"
          onClick={handleResend}
          className="mt-4 text-sm font-medium text-accent hover:text-accent-deep"
        >
          Resend code
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-5 text-lg font-semibold text-ink">Welcome back</h1>
      <form onSubmit={handleSignIn} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
        </div>
        {error && <ErrorNote message={error} />}

        {/* Clerk Smart CAPTCHA mounts here (required for custom flows). */}
        <div id="clerk-captcha" />

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
      <button
        type="button"
        onClick={() => {
          setView("forgot");
          setError(null);
        }}
        className="mt-4 text-sm font-medium text-accent hover:text-accent-deep"
      >
        Forgot password?
      </button>
      <p className="mt-6 text-xs text-muted">
        Staff accounts are invite-only. Ask an admin if you don&apos;t have one yet.
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <Shell>
        <LoginContent />
      </Shell>
    </Suspense>
  );
}
