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

function getStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: "Weak", color: "bg-error" };
  if (score <= 2) return { score, label: "Fair", color: "bg-warning" };
  if (score <= 3) return { score, label: "Good", color: "bg-accent" };
  return { score, label: "Strong", color: "bg-sage" };
}

const inputClass = "w-full px-4 py-3 text-sm bg-warm border border-border rounded-md text-ink placeholder:text-muted/60 outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200";

export default function ResetPasswordPage() {
  const [step, setStep] = useState<"phone" | "password">("phone");
  const [otpSent, setOtpSent] = useState(false);
  const [password, setPassword] = useState("");
  const strength = getStrength(password);

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-16 bg-warm">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[350px] rounded-full bg-accent-glow/15 blur-3xl" />
      </div>

      <motion.div initial="hidden" animate="visible" variants={fadeUp} className="relative w-full max-w-md">
        <div className="bg-card rounded-xl shadow-hover border border-border p-8 sm:p-10">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {["Verify identity", "New password"].map((label, i) => {
              const isCurrent = (i === 0 && step === "phone") || (i === 1 && step === "password");
              const isDone = i === 0 && step === "password";
              return (
                <div key={label} className="flex items-center gap-2">
                  {i > 0 && <div className="h-px w-6 bg-border" />}
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold",
                      isDone ? "bg-sage text-white" : isCurrent ? "bg-accent text-white" : "bg-warm border border-border text-muted"
                    )}>
                      {isDone ? "✓" : i + 1}
                    </div>
                    <span className={cn("text-xs font-medium", isCurrent ? "text-ink" : "text-muted")}>{label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {step === "phone" && (
            <>
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-full bg-accent-glow/30 mx-auto mb-5 flex items-center justify-center">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-deep)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.9 19.79 19.79 0 0 1 1.61 3.27 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-2">Verify your identity</h1>
                <p className="text-sm text-muted">We'll send a one-time code to your registered phone number</p>
              </div>

              <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-ink mb-1.5">Phone number</label>
                  <div className="flex gap-2">
                    <input id="phone" type="tel" placeholder="+65 9123 4567" className={cn(inputClass, "flex-1")} />
                    <button
                      type="button"
                      onClick={() => setOtpSent(true)}
                      className="shrink-0 px-4 py-3 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-deep transition-colors"
                    >
                      {otpSent ? "Resend" : "Send OTP"}
                    </button>
                  </div>
                </div>

                {otpSent && (
                  <div>
                    <label htmlFor="otp" className="block text-sm font-medium text-ink mb-1.5">One-time code</label>
                    <input id="otp" type="text" placeholder="6-digit code" maxLength={6} className={cn(inputClass, "font-mono tracking-widest text-center text-lg")} />
                    <p className="text-xs text-muted mt-1.5">Didn't receive it? <button onClick={() => setOtpSent(false)} className="text-accent-deep hover:text-accent underline">Try again</button></p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setStep("password")}
                  disabled={!otpSent}
                  className={cn(
                    "w-full py-3 text-sm font-semibold text-white rounded-md shadow-soft transition-all duration-300",
                    otpSent ? "bg-accent hover:bg-accent-deep hover:shadow-hover" : "bg-muted/30 cursor-not-allowed"
                  )}
                >
                  Verify & Continue
                </button>
              </form>
            </>
          )}

          {step === "password" && (
            <>
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-full bg-sage-light mx-auto mb-5 flex items-center justify-center">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h1 className="font-serif text-2xl sm:text-3xl text-ink mb-2">New password</h1>
                <p className="text-sm text-muted">Choose a strong password for your account</p>
              </div>

              <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-ink mb-1.5">New password</label>
                  <input
                    id="newPassword"
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                  {password.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div key={level} className={cn("h-1.5 flex-1 rounded-full transition-all duration-300", level <= strength.score ? strength.color : "bg-border")} />
                        ))}
                      </div>
                      <p className={cn("text-xs font-medium", strength.score <= 1 ? "text-error" : strength.score <= 2 ? "text-warning" : strength.score <= 3 ? "text-accent-deep" : "text-sage")}>
                        {strength.label}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink mb-1.5">Confirm new password</label>
                  <input id="confirmPassword" type="password" placeholder="Repeat your new password" className={inputClass} />
                </div>

                <button type="submit" className="w-full py-3 text-sm font-semibold text-white bg-accent rounded-md hover:bg-accent-deep shadow-soft hover:shadow-hover transition-all duration-300">
                  Reset Password
                </button>
              </form>
            </>
          )}

          <p className="text-center text-sm text-muted mt-6">
            Remember your password?{" "}
            <Link href="/login" className="text-accent-deep font-medium hover:text-accent transition-colors">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
