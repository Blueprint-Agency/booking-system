"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");

  return (
    <AuthSplitShell
      imageKey="hero-meditation-01"
      quote="Stillness is the teacher."
    >
      {!sent ? (
        <>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            Forgot your password?
          </h1>
          <p className="text-sm text-muted mt-2">
            Enter your email and we&apos;ll send you a reset link.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
            className="mt-10 space-y-4"
          >
            <div>
              <label
                htmlFor="email"
                className="text-xs uppercase tracking-wider text-muted mb-2 block"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
              className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send reset link
            </button>
          </form>

          <Link
            href="/login"
            className="text-sm text-muted hover:text-ink text-center block mt-8"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <div className="text-center">
          <CheckCircle2 className="h-12 w-12 text-sage mx-auto" />
          <h2 className="text-xl font-bold mt-4 text-ink">Check your email</h2>
          <p className="text-sm text-muted mt-2">
            We sent a reset link to {email}.
          </p>
          <Link
            href="/login"
            className="text-sm text-muted hover:text-ink text-center block mt-8"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </AuthSplitShell>
  );
}
