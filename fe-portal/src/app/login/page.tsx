"use client";
import { Suspense, useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { PasswordInput } from "@/components/auth/password-input";
import { OtpInput } from "@/components/auth/otp-input";

// Unexpected throw → readable message.
function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: Array<{ message?: string }> };
  return (
    e?.errors?.[0]?.message ??
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-base font-bold text-white shadow-soft">
            YS
          </span>
          <div className="text-lg font-semibold tracking-tight text-ink">
            Yoga Sadhana
            <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Staff
            </span>
          </div>
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
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only honour internal paths — never an absolute/protocol-relative URL — so a
  // crafted ?next= can't turn the login into an open redirect.
  const rawNext = searchParams?.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/admin";

  const [view, setView] = useState<"signin" | "forgot" | "reset">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signIn) return;

    setSubmitting(true);
    try {
      const { error: createErr } = await signIn.create({ identifier: email.trim() });
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
      const { error: finalErr } = await signIn.finalize();
      if (finalErr) {
        setError(clerkApiError(finalErr) ?? "Could not complete sign in.");
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
      const { error: createErr } = await signIn.create({ identifier: email.trim() });
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
      const { error: finalErr } = await signIn.finalize();
      if (finalErr) {
        setError(clerkApiError(finalErr) ?? "Could not complete sign in.");
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
