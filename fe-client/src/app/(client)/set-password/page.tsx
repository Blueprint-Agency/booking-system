"use client";
/**
 * Where a member's set-password link lands (#173): `?token=` from the link, or
 * `?error=INVALID_TOKEN` when the link was used or has expired.
 *
 * The same page sets a first password (an imported member, one an admin added,
 * one who joined by code before passwords) and replaces a forgotten one. The
 * backend spends the token and answers with a session at this studio
 * (`POST /public/members/set-password`), so setting the password is signing in.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ApiError, publicApi } from "@/lib/api";
import { memberAuthMessage } from "@/lib/auth-messages";
import { adoptMemberSession } from "@/lib/member-auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

const inputClass =
  "min-h-[44px] rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-sm font-medium text-ink mb-1.5 block";
const primaryBtnClass =
  "flex w-full min-h-[48px] items-center justify-center rounded-full bg-ink text-paper py-3 text-sm font-semibold hover:bg-ink/90 mt-2 disabled:opacity-50";
const titleClass = "text-2xl sm:text-3xl font-extrabold tracking-tight text-ink mb-2";

const IMAGE_KEY = "hero-yoga-01";
const QUOTE = "The pose you avoid is the one you need most.";
const MIN_LENGTH = MIN_PASSWORD_LENGTH;

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const linkError = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    void (async () => {
      try {
        const signedIn = await publicApi.post<{ token: string }>("/public/members/set-password", {
          token,
          password,
        });
        // A link is its studio's own: another studio's is refused as
        // `invalid_token` before anything is set, so a success is a member here.
        adoptMemberSession(signedIn.token);
        router.replace("/");
      } catch (err) {
        if (err instanceof ApiError) {
          setError(
            memberAuthMessage(
              { status: err.status, ...(err.body as object | null) },
              "We couldn't set your password. Please try again.",
            ),
          );
        } else {
          setError("We couldn't reach the server. Check your connection and try again.");
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }

  if (!token || linkError) {
    return (
      <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
        <h1 className={titleClass}>
          This link has expired
        </h1>
        <p className="text-sm text-muted mb-6">
          A set-password link works once, for 30 minutes. Enter your email again and
          we&apos;ll send you a new one.
        </p>
        <Link href="/login" className={primaryBtnClass}>
          Back to sign in
        </Link>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
      <h1 className={titleClass}>
        Set your password
      </h1>
      <p className="text-sm text-muted mb-6">
        Choose a password of at least {MIN_LENGTH} characters. You&apos;ll be signed in straight away.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className={labelClass}>New password</label>
          <input id="password" type="password" autoComplete="new-password" autoFocus
            className={inputClass} value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm password</label>
          <input id="confirm" type="password" autoComplete="new-password"
            className={inputClass} value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p>
        ) : null}
        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </AuthSplitShell>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordContent />
    </Suspense>
  );
}
