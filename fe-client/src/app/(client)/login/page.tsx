"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { GoogleLogo } from "@/components/auth/google-logo";
import { signIn } from "@/lib/mock-state";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const completeAuth = () => {
    signIn(email);
    router.push(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    completeAuth();
  };

  return (
    <AuthSplitShell
      imageKey="hero-yoga-01"
      quote="The pose you avoid is the one you need most."
    >
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">
        Welcome back
      </h1>
      <p className="text-sm text-muted mt-2">
        Sign in to continue your practice.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-4">
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
            className="rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="text-xs uppercase tracking-wider text-muted mb-2 block"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between text-xs mt-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-ink/10 text-accent"
            />
            <span className="text-muted">Remember me</span>
          </label>
          <Link
            href="/forgot-password"
            className="text-accent-deep font-medium"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          className="w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-6"
        >
          Sign in
        </button>
      </form>

      <div className="my-8 flex items-center gap-3 text-xs text-muted">
        <div className="h-px flex-1 bg-ink/10" />
        or continue with
        <div className="h-px flex-1 bg-ink/10" />
      </div>

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={completeAuth}
          className="flex items-center justify-center gap-3 rounded-full border border-ink/10 py-3 text-sm font-medium hover:border-accent"
        >
          <GoogleLogo />
          Continue with Google
        </button>
      </div>

      <p className="text-sm text-muted text-center mt-8">
        Don&apos;t have an account?{" "}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="text-accent-deep font-medium">
          Sign up
        </Link>
      </p>
    </AuthSplitShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
