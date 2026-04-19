"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { GoogleLogo } from "@/components/auth/google-logo";
import { cn } from "@/lib/utils";
import { signUp } from "@/lib/mock-state";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s\-]{8,}$/;

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const completeAuth = () => {
    signUp({
      firstName: firstName.trim() || "Member",
      lastName: lastName.trim() || "",
      email: email.trim() || "member@example.com",
      phone: phone.trim() || undefined,
      gender: gender || undefined,
    });
    router.push(next);
  };
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [gender, setGender] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [emailVerified, setEmailVerified] = useState(false);

  const emailValid = EMAIL_REGEX.test(email);
  const phoneValid = PHONE_REGEX.test(phone);
  const passwordValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    emailValid &&
    emailVerified &&
    phoneValid &&
    passwordValid &&
    passwordsMatch &&
    gender.length > 0 &&
    agreed;

  return (
    <AuthSplitShell
      imageKey="hero-pilates-01"
      quote="Every student begins with a single breath."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="text-sm text-muted mt-2">Two locations. One practice.</p>

      <div className="mt-8 grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={completeAuth}
          className="flex items-center justify-center gap-3 rounded-full border border-ink/10 py-3 text-sm font-medium hover:border-accent"
        >
          <GoogleLogo />
          Sign up with Google
        </button>
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <div className="h-px flex-1 bg-ink/10" />
        or sign up with email
        <div className="h-px flex-1 bg-ink/10" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          completeAuth();
        }}
        className="space-y-4"
        noValidate
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name
            </label>
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email address
          </label>
          <div className="flex gap-2">
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailVerified) setEmailVerified(false);
              }}
              placeholder="you@example.com"
              className={cn(inputClass, "flex-1")}
            />
            <button
              type="button"
              disabled={!emailValid}
              onClick={() => setEmailVerified(true)}
              className="shrink-0 rounded-xl border border-ink/10 px-4 py-3 text-xs font-medium text-muted hover:text-ink hover:bg-ink/5 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {emailVerified ? "Verified" : "Verify"}
            </button>
          </div>
          {email.length > 0 && !emailValid && (
            <p className="mt-1.5 text-xs text-red-600">Enter a valid email address.</p>
          )}
          {emailVerified && (
            <p className="mt-1.5 text-xs text-accent-deep">Email verified.</p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone number
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+65 9123 4567"
            className={inputClass}
          />
          {phone.length > 0 && !phoneValid && (
            <p className="mt-1.5 text-xs text-red-600">Enter a valid phone number.</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className={inputClass}
          />
          {password.length > 0 && !passwordValid && (
            <p className="mt-1.5 text-xs text-red-600">Password must be at least 8 characters.</p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className={labelClass}>
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            className={inputClass}
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="mt-1.5 text-xs text-red-600">Passwords do not match.</p>
          )}
        </div>

        <div>
          <label htmlFor="gender" className={labelClass}>
            Gender
          </label>
          <select
            id="gender"
            required
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className={cn(inputClass, "cursor-pointer")}
          >
            <option value="" disabled>
              Select gender
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </div>

        <div>
          <label htmlFor="referralCode" className={labelClass}>
            Referral code (optional)
          </label>
          <input
            id="referralCode"
            type="text"
            placeholder="e.g. YS8472"
            maxLength={6}
            className={cn(inputClass, "font-mono uppercase tracking-widest")}
          />
        </div>

        <label className="flex items-start gap-3 mt-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-ink/20 text-accent focus:ring-accent/30 bg-paper shrink-0"
          />
          <span className="text-xs text-muted">
            I agree to the{" "}
            <Link href="/terms" className="text-accent-deep">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-accent-deep">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <button
          type="submit"
          className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create account
        </button>
      </form>

      <p className="text-sm text-muted text-center mt-8">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-accent-deep font-medium">
          Sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
