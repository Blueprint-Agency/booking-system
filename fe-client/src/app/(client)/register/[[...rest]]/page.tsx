"use client";
/**
 * Member registration (#117, #173): details (gender included), an email and a
 * password typed twice, then the
 * one-time code mailed to the email, which proves it.
 *
 * The code is asked of the `client` Better Auth pool, and spent by the backend's
 * own register route (`POST /public/members/register`), which writes the auth
 * user, its password, this studio's `clients` row and the session together and
 * answers with the session token. So no account exists until the email is
 * proven, and a member is never signed in without an account here.
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
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";
import { OtpInput } from "@/components/auth/otp-input";

const inputClass =
  "min-h-[44px] rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none";
const labelClass =
  "text-sm font-medium text-ink mb-1.5 block";
const primaryBtnClass =
  "w-full min-h-[48px] rounded-full bg-ink text-paper py-3 text-sm font-semibold hover:bg-ink/90 mt-2 disabled:opacity-50";
const titleClass = "text-2xl sm:text-3xl font-extrabold tracking-tight text-ink";
/** A text-styled action, still a full-height touch target. */
const textBtnClass = "inline-flex min-h-[44px] items-center font-medium text-accent-deep hover:underline disabled:opacity-50";

type Gender = "female" | "male" | "prefer_not_to_say";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

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
  const [gender, setGender] = useState<Gender | "">("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    if (!gender) {
      setError("Please choose a gender, or “Prefer not to say”.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
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
          gender,
          password,
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
        <h1 className={`${titleClass} mb-2`}>
          One moment…
        </h1>
      </AuthSplitShell>
    );
  }

  const errorNote = error ? (
    <p role="alert" className="text-sm text-error rounded-xl border border-error/30 bg-error/10 px-3 py-2">{error}</p>
  ) : null;

  if (view === "verify") {
    return (
      <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
        <h1 className={`${titleClass} mb-2`}>
          Check your email
        </h1>
        <p className="text-sm text-muted mb-6">
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
        <div className="mt-2 flex flex-wrap gap-x-5 text-sm">
          <button type="button" onClick={handleResend} disabled={submitting} className={textBtnClass}>
            Resend code
          </button>
          <button
            type="button"
            onClick={() => { setView("form"); setError(null); }}
            className={textBtnClass}
          >
            Change details
          </button>
        </div>
      </AuthSplitShell>
    );
  }

  return (
    <AuthSplitShell imageKey={IMAGE_KEY} quote={QUOTE}>
      <h1 className={`${titleClass} mb-6`}>
        Create your account
      </h1>
      <form onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-4 min-[400px]:gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>First name</label>
            <input id="firstName" autoComplete="given-name" className={inputClass} value={firstName}
              onChange={(ev) => setFirstName(ev.target.value)} />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>Last name</label>
            <input id="lastName" autoComplete="family-name" className={inputClass} value={lastName}
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
        <div>
          <label htmlFor="gender" className={labelClass}>Gender</label>
          <select id="gender" className={inputClass} value={gender}
            onChange={(ev) => setGender(ev.target.value as Gender | "")}>
            <option value="" disabled>Select…</option>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <input id="password" type="password" autoComplete="new-password" className={inputClass}
            value={password} onChange={(ev) => setPassword(ev.target.value)} />
          <p className="mt-1 text-xs text-muted">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
          <input id="confirmPassword" type="password" autoComplete="new-password" className={inputClass}
            value={confirmPassword} onChange={(ev) => setConfirmPassword(ev.target.value)} />
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
