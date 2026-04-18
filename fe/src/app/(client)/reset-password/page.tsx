"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = newPw.length > 0 && newPw.length < 8;
  const mismatch = newPw.length > 0 && confirm.length > 0 && newPw !== confirm;
  const canSubmit = newPw.length >= 8 && confirm.length > 0 && !mismatch;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    void token;
    setDone(true);
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="h-12 w-12 text-sage mx-auto" />
        <h2 className="text-xl font-bold mt-4 text-ink">Password updated</h2>
        <p className="text-sm text-muted mt-2">
          You can now sign in with your new password.
        </p>
        <Link
          href="/login"
          className="inline-block mt-6 rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">
        Set a new password
      </h1>
      <p className="text-sm text-muted mt-2">
        Choose something you&apos;ll remember (or store in a password manager).
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-4">
        <div>
          <label
            htmlFor="newPassword"
            className="text-xs uppercase tracking-wider text-muted mb-2 block"
          >
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            required
            minLength={8}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="At least 8 characters"
            className="rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none"
          />
          {tooShort && (
            <p className="text-xs text-error mt-2">Password must be at least 8 characters.</p>
          )}
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="text-xs uppercase tracking-wider text-muted mb-2 block"
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none"
          />
          {mismatch && (
            <p className="text-xs text-error mt-2">Passwords don&apos;t match.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Update password
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthSplitShell imageKey="hero-yoga-01" quote="Reset. Breathe. Begin again.">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthSplitShell>
  );
}
