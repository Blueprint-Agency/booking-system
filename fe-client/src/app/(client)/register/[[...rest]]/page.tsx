"use client";
/**
 * Member registration (#117): details and an email, then the one-time code
 * mailed to it.
 *
 * The code is asked of the `client` Better Auth pool, and spent by the backend's
 * own register route (`POST /public/members/register`), which writes the auth
 * user, this studio's `clients` row and the session together and answers with
 * the session token. So a member is never signed in without an account here.
 */
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import Link from "next/link";
import { ApiError, publicApi } from "@/lib/api";
import { safeNextPath, signedInRedirectTarget } from "@/lib/auth-redirect";
import { memberAuthMessage } from "@/lib/auth-messages";
import { adoptMemberSession, memberAuth, useMemberSession } from "@/lib/member-auth";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { OtpInput } from "@/components/auth/otp-input";

const inputClass =
  "rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-xs uppercase tracking-wider text-muted mb-2 block";
const primaryBtnClass =
  "w-full rounded-full bg-ink text-paper py-3 text-sm font-medium hover:bg-ink/90 mt-2 disabled:opacity-50";

const IMAGE_KEY = "hero-pilates-01";
const QUOTE = "Every student begins with a single breath.";

function RegisterContent() {
  const { isLoaded, isSignedIn } = useMemberSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams) ?? "/";

  const [view, setView] = useState<"form" | "verify">("form");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Nobody signed in needs to create an account; send them where they were going.
  const redirectTarget =
    isSignedIn && !submitting ? signedInRedirectTarget(pathname ?? "", searchParams) : null;
  useEffect(() => {
    if (redirectTarget) router.replace(redirectTarget);
  }, [redirectTarget, router]);

  async function run(step: () => Promise<void>) {
    setError(null);
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
      setError(memberAuthMessage(sendErr, "Could not send a verification code."));
      return false;
    }
    return true;
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    void run(async () => {
      if (!(await sendCode())) return;
      setCode("");
      setView("verify");
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      try {
        const { token } = await publicApi.post<{ token: string }>("/public/members/register", {
          email: email.trim(),
          otp: code.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone,
        });
        adoptMemberSession(token);
        router.replace(next);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        setError(
          memberAuthMessage(
            { status: err.status, ...(err.body as object | null) },
            "We couldn't create your account. Please check your details and try again.",
          ),
        );
      }
    });
  }

  function handleResend() {
    void run(async () => {
      await sendCode();
    });
  }

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

  if (view === "verify") {
    return (
      <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">
          Check your email
        </h1>
        <p className="text-sm text-muted mb-8">
          We sent a 6-digit code to {email.trim()}.
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label className={labelClass}>
              Verification code
            </label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          {errorNote}
          <button type="submit" disabled={submitting} className={primaryBtnClass}>
            {submitting ? "Verifying…" : "Verify & create account"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <button type="button" onClick={handleResend} disabled={submitting} className="font-medium text-accent-deep">
            Resend code
          </button>
          <button
            type="button"
            onClick={() => { setView("form"); setError(null); }}
            className="font-medium text-accent-deep"
          >
            Change details
          </button>
        </div>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-8">
        Create your account
      </h1>
      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>First name</label>
            <input id="firstName" className={inputClass} value={firstName}
              onChange={(ev) => setFirstName(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>Last name</label>
            <input id="lastName" className={inputClass} value={lastName}
              onChange={(ev) => setLastName(ev.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input id="email" type="email" autoComplete="email" className={inputClass}
            value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone</label>
          <PhoneInput
            id="phone"
            international
            defaultCountry="SG"
            value={phone}
            onChange={setPhone}
            className="phone-input"
          />
        </div>

        {errorNote}

        <button type="submit" disabled={submitting} className={primaryBtnClass}>
          {submitting ? "Sending code…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-deep font-medium">Sign in</Link>
      </p>
    </AuthSplitShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
