"use client";

import { Suspense, useState } from "react";
import { useSignUp } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import Link from "next/link";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { OtpInput } from "@/components/auth/otp-input";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";
const primaryBtnClass =
  "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2 disabled:opacity-50";

// Map a Clerk error to a readable message.
function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: Array<{ code?: string; message?: string }> };
  const first = e?.errors?.[0];
  if (first?.code === "form_identifier_exists") {
    return "An account with this email already exists. Try signing in instead.";
  }
  return first?.message ?? "We couldn't create your account. Please check your details and try again.";
}

function clerkApiError(err: { code?: string; message?: string } | null | undefined): string | null {
  if (!err) return null;
  if (err.code === "form_identifier_exists") {
    return "An account with this email already exists. Try signing in instead.";
  }
  return err.message ?? "We couldn't create your account. Please check your details and try again.";
}

function RegisterContent() {
  const { signUp } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [view, setView] = useState<"form" | "verify">("form");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!signUp) return;

    setSubmitting(true);
    try {
      const { error: createErr } = await signUp.create({
        emailAddress: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        unsafeMetadata: { phone },
      });
      if (createErr) {
        setError(clerkApiError(createErr) ?? "Could not create account.");
        return;
      }

      const { error: pwErr } = await signUp.password({
        password,
        emailAddress: email.trim(),
      });
      if (pwErr) {
        setError(clerkApiError(pwErr) ?? "Could not set password.");
        return;
      }

      const { error: sendErr } = await signUp.verifications.sendEmailCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not send verification code.");
        return;
      }

      setView("verify");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!signUp) return;

    setSubmitting(true);
    try {
      const { error: verifyErr } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (verifyErr) {
        setError(clerkApiError(verifyErr) ?? "Invalid or expired code.");
        return;
      }

      const { error: finalErr } = await signUp.finalize();
      if (finalErr) {
        setError(clerkApiError(finalErr) ?? "Could not complete sign-up.");
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
    if (!signUp) return;
    try {
      const { error: sendErr } = await signUp.verifications.sendEmailCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not resend code.");
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  }

  if (view === "verify") {
    return (
      <AuthSplitShell
        imageKey="hero-pilates-01"
        quote="Every student begins with a single breath."
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Check your email
        </h1>
        <p className="text-sm text-muted mb-8">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className={labelClass}>
              Verification code
            </label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          {error ? <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p> : null}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Verifying…" : "Verify & create account"}
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
      imageKey="hero-pilates-01"
      quote="Every student begins with a single breath."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-8">
        Create your account
      </h1>
      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>First name</label>
            <input id="firstName" className={inputClass} value={firstName}
              onChange={(ev) => setFirstName(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>Last name</label>
            <input id="lastName" className={inputClass} value={lastName}
              onChange={(ev) => setLastName(ev.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" className={inputClass}
            value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone</label>
          <PhoneInput
            id="phone"
            international
            defaultCountry="SG"
            value={phone}
            onChange={setPhone}
            className="ys-phone-input"
          />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <input id="password" type="password" autoComplete="new-password" className={inputClass}
            value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm password</label>
          <input id="confirm" type="password" autoComplete="new-password" className={inputClass}
            value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
        </div>

        {error ? <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p> : null}

        {/* Clerk Smart CAPTCHA mounts here (required for custom sign-up flows). */}
        <div id="clerk-captcha" />

        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-deep font-medium">Sign in</Link>
      </p>
    </AuthSplitShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
