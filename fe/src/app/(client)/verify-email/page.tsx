"use client";

import { useEffect, useRef, useState } from "react";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

export default function VerifyEmailPage() {
  const email = "jane@example.com";
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleChange = (i: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const handleKeyDown = (
    i: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    setCooldown(30);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <AuthSplitShell
      imageKey="hero-meditation-01"
      quote="One step closer to your first class."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">
        Verify your email
      </h1>
      <p className="text-sm text-muted mt-2">
        We sent a 6-digit code to {email}. Enter it below.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="mt-10 flex gap-2 justify-between">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              maxLength={1}
              inputMode="numeric"
              className="h-14 w-12 rounded-xl border border-ink/10 bg-paper text-center text-2xl font-bold text-ink focus:border-accent focus:outline-none"
            />
          ))}
        </div>

        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="text-sm text-accent-deep mt-4 hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>

        <button
          type="submit"
          className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6"
        >
          Verify
        </button>
      </form>
    </AuthSplitShell>
  );
}
