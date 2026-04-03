"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const inputClass = "w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200";
const labelClass = "block text-sm font-medium text-ink mb-1.5";

export default function RegisterPage() {
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-16 bg-warm">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-sage-light/30 blur-3xl" />
      </div>

      <motion.div initial="hidden" animate="visible" variants={fadeUp} className="relative w-full max-w-md">
        <div className="bg-card rounded-xl shadow-hover border border-border p-8 sm:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-lg bg-sage mx-auto mb-4 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-2">Create your account</h1>
            <p className="text-sm text-muted">Start your yoga journey with Yoga Sadhana</p>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            {/* First name */}
            <div>
              <label htmlFor="firstName" className={labelClass}>First name</label>
              <input id="firstName" type="text" placeholder="Jane" className={inputClass} />
            </div>

            {/* Phone + OTP */}
            <div>
              <label htmlFor="phone" className={labelClass}>Phone number</label>
              <div className="flex gap-2">
                <input
                  id="phone"
                  type="tel"
                  placeholder="+65 9123 4567"
                  className={cn(inputClass, "flex-1")}
                />
                <button
                  type="button"
                  onClick={() => { setOtpSent(true); setOtpVerified(false); }}
                  className="shrink-0 px-4 py-3 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                >
                  {otpSent ? "Resend" : "Send OTP"}
                </button>
              </div>
              {otpSent && !otpVerified && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    className={cn(inputClass, "flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() => setOtpVerified(true)}
                    className="shrink-0 px-4 py-3 text-sm font-medium text-white bg-sage rounded-md hover:bg-sage/90 transition-colors"
                  >
                    Verify
                  </button>
                </div>
              )}
              {otpVerified && (
                <p className="mt-1.5 text-xs text-sage flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Phone verified
                </p>
              )}
            </div>

            {/* Email + verification */}
            <div>
              <label htmlFor="email" className={labelClass}>Email address</label>
              <div className="flex gap-2">
                <input id="email" type="email" placeholder="you@example.com" className={cn(inputClass, "flex-1")} />
                <button
                  type="button"
                  onClick={() => setEmailVerified(true)}
                  className="shrink-0 px-4 py-3 text-sm font-medium text-muted border border-border rounded-md hover:text-ink hover:bg-warm transition-colors whitespace-nowrap"
                >
                  {emailVerified ? "Sent ✓" : "Verify"}
                </button>
              </div>
              {emailVerified && (
                <p className="mt-1.5 text-xs text-muted">Verification email sent — check your inbox.</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className={labelClass}>Password</label>
              <input id="password" type="password" placeholder="At least 8 characters" className={inputClass} />
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
              <input id="confirmPassword" type="password" placeholder="Repeat your password" className={inputClass} />
            </div>

            {/* Gender */}
            <div>
              <label htmlFor="gender" className={labelClass}>Gender</label>
              <select id="gender" className={cn(inputClass, "cursor-pointer")}>
                <option value="" disabled selected>Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
            </div>

            {/* Birthday */}
            <div>
              <label htmlFor="birthday" className={labelClass}>Birthday</label>
              <input id="birthday" type="date" className={inputClass} />
            </div>

            {/* Referral code */}
            <div>
              <label htmlFor="referralCode" className={labelClass}>
                Referral code
                <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
              </label>
              <input
                id="referralCode"
                type="text"
                placeholder="e.g. YS8472"
                maxLength={6}
                className={cn(inputClass, "font-mono uppercase tracking-widest")}
              />
              <p className="text-xs text-muted mt-1">Automatically filled if you joined via a referral link.</p>
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer group pt-1">
              <input type="checkbox" className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent/30 bg-warm shrink-0" />
              <span className="text-sm text-muted group-hover:text-ink transition-colors leading-snug">
                I agree to the{" "}
                <Link href="#" className="text-accent-deep hover:text-accent underline underline-offset-2">Terms of Service</Link>
                {" "}and{" "}
                <Link href="#" className="text-accent-deep hover:text-accent underline underline-offset-2">Privacy Policy</Link>
              </span>
            </label>

            {/* Submit */}
            <button
              type="submit"
              className="w-full py-3 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300 mt-2"
            >
              Create Account
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-accent-deep font-medium hover:text-accent transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
