"use client";

import { Suspense, useState } from "react";
import { useClerk, useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { OtpInput } from "@/components/auth/otp-input";
import { PasswordInput } from "@/components/auth/password-input";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";
const primaryBtnClass =
  "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2 disabled:opacity-50";

// Unexpected throw → readable message.
function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: Array<{ code?: string; message?: string }> };
  return e?.errors?.[0]?.message ?? "We couldn't sign you in. Please check your details and try again.";
}

// Returned `{ error }` from a future-API call → readable message.
function clerkApiError(err: { code?: string; message?: string } | null | undefined): string | null {
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

function LoginContent() {
  const { signIn } = useSignIn();
  const { setActive } = useClerk();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only honour internal paths — never an absolute/protocol-relative URL — so a
  // crafted ?next= can't redirect an authenticated member off-site.
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const [view, setView] = useState<"signin" | "forgot" | "reset">(
    searchParams.get("reset") === "1" ? "forgot" : "signin",
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
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

  async function activateCreatedSession(
    createdSessionId: string | null | undefined,
    fallbackMessage: string,
  ): Promise<string | null> {
    if (!createdSessionId) return fallbackMessage;
    await setActive({ session: createdSessionId });
    return null;
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
      const { error: pwErr } = await signIn.password({ password, identifier: email.trim() });
      if (pwErr) {
        setError(clerkApiError(pwErr) ?? "Incorrect email or password.");
        return;
      }
      const activationErr = await activateCreatedSession(
        signIn.createdSessionId,
        "Could not complete sign in.",
      );
      if (activationErr) {
        setError(activationErr);
        return;
      }
      router.push(next);
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
      const { error: verifyErr } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (verifyErr) {
        setError(clerkApiError(verifyErr) ?? "Invalid or expired code.");
        return;
      }
      const { error: submitErr } = await signIn.resetPasswordEmailCode.submitPassword({ password: newPassword });
      if (submitErr) {
        setError(clerkApiError(submitErr) ?? "Could not reset password.");
        return;
      }
      const activationErr = await activateCreatedSession(
        signIn.createdSessionId,
        "Could not complete sign in.",
      );
      if (activationErr) {
        setError(activationErr);
        return;
      }
      router.push(next);
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

  if (view === "forgot") {
    return (
      <AuthSplitShell
        imageKey="hero-yoga-01"
        quote="The pose you avoid is the one you need most."
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Reset your password
        </h1>
        <p className="text-sm text-muted mb-8">
          Enter your email and we&apos;ll send you a reset code.
        </p>
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input id="email" type="email" autoComplete="email" className={inputClass}
              value={email} onChange={(ev) => setEmail(ev.target.value)} />
          </div>
          {error ? <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p> : null}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Sending…" : "Send reset code"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => { setView("signin"); setError(null); }}
          className="mt-4 text-sm text-accent-deep font-medium"
        >
          Back to sign in
        </button>
      </AuthSplitShell>
    );
  }

  if (view === "reset") {
    return (
      <AuthSplitShell
        imageKey="hero-yoga-01"
        quote="The pose you avoid is the one you need most."
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Enter reset code
        </h1>
        <p className="text-sm text-muted mb-8">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className={labelClass}>Verification code</label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          <div>
            <label htmlFor="newPassword" className={labelClass}>New password</label>
            <PasswordInput id="newPassword" autoComplete="new-password" className={inputClass}
              value={newPassword} onChange={(ev) => setNewPassword(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="confirm" className={labelClass}>Confirm new password</label>
            <PasswordInput id="confirm" autoComplete="new-password" className={inputClass}
              value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
          </div>
          {error ? <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p> : null}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Resetting…" : "Reset password & sign in"}
          </button>
        </form>
        <button
          type="button"
          onClick={handleResend}
          className="mt-4 text-sm text-accent-deep font-medium"
        >
          Resend code
        </button>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell
      imageKey="hero-yoga-01"
      quote="The pose you avoid is the one you need most."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-8">
        Welcome back
      </h1>
      <form onSubmit={handleSignIn} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" className={inputClass}
            value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <PasswordInput id="password" autoComplete="current-password" className={inputClass}
            value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </div>
        {error ? <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p> : null}

        {/* Clerk Smart CAPTCHA mounts here (required for custom flows). */}
        <div id="clerk-captcha" />

        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => { setView("forgot"); setError(null); }}
        className="mt-4 text-sm text-accent-deep font-medium"
      >
        Forgot password?
      </button>
      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="text-accent-deep font-medium">Create an account</Link>
      </p>
    </AuthSplitShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
