"use client";
/**
 * Member sign-in: an email, then the one-time code mailed to it (#117), against
 * the `client` Better Auth pool on this studio's hostname.
 *
 * A code signs in any address, but an address is a member only where it has a
 * `clients` row. So once the session exists the page asks for the profile, and
 * an address with no account at this studio is signed straight back out and
 * pointed at registration — rather than left signed in to an app that answers
 * every request with `client_not_found`.
 */
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeNextPath, signedInRedirectTarget } from "@/lib/auth-redirect";
import { memberAuthMessage } from "@/lib/auth-messages";
import { fetchApi } from "@/lib/api-url";
import { memberAuth, readMemberToken, signOutMember, useMemberSession } from "@/lib/member-auth";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { OtpInput } from "@/components/auth/otp-input";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";
const primaryBtnClass =
  "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2 disabled:opacity-50";

const IMAGE_KEY = "hero-yoga-01";
const QUOTE = "The pose you avoid is the one you need most.";

/** Is the signed-in address a member at this studio? Only a profile is a yes. */
async function accountHere(): Promise<"yes" | "none" | "unknown"> {
  const token = readMemberToken();
  if (!token) return "unknown";
  const res = await fetchApi("/me", { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return "yes";
  return res.status === 404 ? "none" : "unknown";
}

function LoginContent() {
  const { isLoaded, isSignedIn } = useMemberSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams) ?? "/";

  const [view, setView] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // A sign-in form is for someone who is not signed in. A live session goes
  // where it was heading. Held back while this page is itself mid-sign-in, so
  // the account check below decides where a fresh session goes.
  const redirectTarget =
    isSignedIn && !submitting ? signedInRedirectTarget(pathname ?? "", searchParams) : null;
  useEffect(() => {
    if (redirectTarget) router.replace(redirectTarget);
  }, [redirectTarget, router]);

  async function run(step: () => Promise<void>) {
    setError(null);
    setNoAccount(false);
    setSubmitting(true);
    try {
      await step();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendCode(): Promise<boolean> {
    const { error: sendErr } = await memberAuth.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
    });
    if (sendErr) {
      setError(memberAuthMessage(sendErr, "Could not send a sign-in code."));
      return false;
    }
    return true;
  }

  function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    void run(async () => {
      if (!(await sendCode())) return;
      setCode("");
      setView("code");
    });
  }

  function handleCode(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { error: signInErr } = await memberAuth.signIn.emailOtp({
        email: email.trim(),
        otp: code.trim(),
      });
      if (signInErr) {
        setError(memberAuthMessage(signInErr, "We couldn't sign you in. Please try again."));
        return;
      }
      const account = await accountHere();
      if (account !== "yes") {
        await signOutMember();
        setView("email");
        if (account === "none") setNoAccount(true);
        else setError("We couldn't sign you in. Please try again.");
        return;
      }
      router.replace(next);
    });
  }

  function handleResend() {
    void run(async () => {
      await sendCode();
    });
  }

  // Either the redirect above is about to run, or the session has not been
  // read yet. Neither is a moment to show a form.
  if (!isLoaded || redirectTarget) {
    return (
      <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          One moment…
        </h1>
      </AuthSplitShell>
    );
  }

  const errorNote = error ? (
    <p className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p>
  ) : null;

  if (view === "code") {
    return (
      <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Check your email
        </h1>
        <p className="text-sm text-muted mb-8">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleCode} className="space-y-4">
          <div>
            <label className={labelClass}>Sign-in code</label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          {errorNote}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <button type="button" onClick={handleResend} disabled={submitting} className="font-medium text-accent-deep">
            Resend code
          </button>
          <button
            type="button"
            onClick={() => { setView("email"); setError(null); }}
            className="font-medium text-accent-deep"
          >
            Use a different email
          </button>
        </div>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
        Welcome back
      </h1>
      <p className="text-sm text-muted mb-8">
        Enter your email and we&apos;ll send you a code to sign in.
      </p>
      <form onSubmit={handleEmail} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" className={inputClass}
            value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        {noAccount ? (
          <p className="text-sm text-ink rounded-xl border border-ink/10 bg-warm px-3 py-2">
            There&apos;s no account for {email.trim()} at this studio yet.{" "}
            <Link
              href={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="text-accent-deep font-medium"
            >
              Create one
            </Link>
          </p>
        ) : null}
        {errorNote}
        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Sending…" : "Email me a code"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="text-accent-deep font-medium">Create an account</Link>
      </p>
    </AuthSplitShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
