"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { cn } from "@/lib/utils";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s\-]{8,}$/;

export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [gender, setGender] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [otp, setOtp] = useState("");

  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
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
    otpVerified &&
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

      <form
        onSubmit={(e) => e.preventDefault()}
        className="mt-10 space-y-4"
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
          <div className="flex gap-2">
            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (otpVerified) setOtpVerified(false);
                if (otpSent) setOtpSent(false);
              }}
              placeholder="+65 9123 4567"
              className={cn(inputClass, "flex-1")}
            />
            <button
              type="button"
              disabled={!phoneValid}
              onClick={() => {
                setOtpSent(true);
                setOtpVerified(false);
              }}
              className="shrink-0 rounded-xl bg-ink text-paper px-4 py-3 text-xs font-medium hover:bg-ink/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {otpSent ? "Resend" : "Send OTP"}
            </button>
          </div>
          {phone.length > 0 && !phoneValid && (
            <p className="mt-1.5 text-xs text-red-600">Enter a valid phone number.</p>
          )}
          {otpSent && !otpVerified && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                className={cn(inputClass, "flex-1")}
              />
              <button
                type="button"
                disabled={otp.length !== 6}
                onClick={() => setOtpVerified(true)}
                className="shrink-0 rounded-xl border border-ink/10 px-4 py-3 text-xs font-medium text-ink hover:bg-ink/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Verify
              </button>
            </div>
          )}
          {otpVerified && (
            <p className="mt-1.5 text-xs text-accent-deep">Phone verified.</p>
          )}
        </div>

        <div>
          <label htmlFor="birthday" className={labelClass}>
            Date of birth
          </label>
          <input
            id="birthday"
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            className={inputClass}
          />
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
          disabled={!canSubmit}
          className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create account
        </button>
      </form>

      <p className="text-sm text-muted text-center mt-8">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-deep font-medium">
          Sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}
