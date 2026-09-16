"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useClerk, useSignUp } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { OtpInput } from "@/components/auth/otp-input";
import { PasswordInput } from "@/components/auth/password-input";
import { StudioMark } from "@/components/brand/studio-mark";
import { fetchApi } from "@/lib/api-url";

type InviteStatus = "valid" | "expired" | "used" | "revoked" | "not_found";
interface InviteLookup {
  status: InviteStatus;
  email: string | null;
  role: string | null;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <StudioMark size="auth" badge="Staff" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}

function InviteNotice({
  title,
  body,
  showSignIn,
}: {
  title: string;
  body: string;
  showSignIn?: boolean;
}) {
  return (
    <div className="text-center">
      <h1 className="text-base font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      {showSignIn && (
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-deep"
        >
          Go to sign in
        </Link>
      )}
    </div>
  );
}

function clerkErrorMessage(err: unknown): string {
  const e = err as {
    code?: string;
    errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
    longMessage?: string;
    message?: string;
  };
  const first = e?.errors?.[0];
  if (first?.code === "form_identifier_exists") {
    return "An account with this email already exists. Sign in instead.";
  }
  return (
    first?.longMessage ??
    first?.message ??
    e?.longMessage ??
    e?.message ??
    first?.code ??
    e?.code ??
    "We couldn't create your account. Please check your details and try again."
  );
}

function clerkApiError(
  err: { code?: string; message?: string } | null | undefined,
): string | null {
  if (!err) return null;
  if (err.code === "form_identifier_exists") {
    return "An account with this email already exists. Sign in instead.";
  }
  return err.message ?? "We couldn't create your account. Please check your details and try again.";
}

function isAlreadySignedInError(err: unknown): boolean {
  const errors = (err as { errors?: Array<{ code?: string; message?: string }> })?.errors ?? [err as { code?: string; message?: string }];
  return errors.some((e) => {
    const code = String(e?.code ?? "").toLowerCase();
    const message = String(e?.message ?? "").toLowerCase();
    return (
      code.includes("session_exists") ||
      code.includes("already_signed") ||
      /already.*sign(ed)? in/.test(message) ||
      /sign(ed)? in.*already/.test(message) ||
      /already.*logged in/.test(message)
    );
  });
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
      {message}
    </p>
  );
}

function SignupForm({ email }: { email?: string }) {
  const { signUp } = useSignUp();
  const { setActive } = useClerk();
  const router = useRouter();
  const [view, setView] = useState<"form" | "verify">("form");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailValue, setEmailValue] = useState(email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailLocked = Boolean(email);

  async function runAuthStep<T extends { error: { code?: string; message?: string } | null }>(
    step: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await step();
      if (!result.error || !isAlreadySignedInError(result.error)) return result;
      await setActive({ session: null });
      return step();
    } catch (err) {
      if (!isAlreadySignedInError(err)) throw err;
      await setActive({ session: null });
      return step();
    }
  }

  function navigateAfterAuth(destination: string) {
    return async ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
      const url = decorateUrl(destination);
      if (/^https?:\/\//i.test(url)) {
        window.location.href = url;
        return;
      }
      router.push(url);
    };
  }

  useEffect(() => {
    if (email) setEmailValue(email);
  }, [email]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!emailValue.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!signUp) return;

    setSubmitting(true);
    try {
      const normalizedEmail = emailValue.trim().toLowerCase();
      const { error: createErr } = await runAuthStep(() => signUp.create({
        emailAddress: normalizedEmail,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      }));
      if (createErr) {
        setError(clerkApiError(createErr) ?? "Could not create account.");
        return;
      }

      const { error: sendErr } = await signUp.verifications.sendEmailCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not send verification code.");
        return;
      }

      setView("verify");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!signUp) return;

    setSubmitting(true);
    try {
      const { error: verifyErr } = await signUp.verifications.verifyEmailCode({
        code: code.trim(),
      });
      if (verifyErr) {
        setError(clerkApiError(verifyErr) ?? "Invalid or expired code.");
        return;
      }

      const { error: finalErr } = await signUp.finalize({
        navigate: navigateAfterAuth("/admin"),
      });
      if (finalErr) {
        setError(clerkApiError(finalErr) ?? "Could not complete sign-up.");
        return;
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    if (!signUp) return;
    try {
      const { error: sendErr } = await signUp.verifications.sendEmailCode();
      if (sendErr) {
        setError(clerkApiError(sendErr) ?? "Could not resend code.");
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
    }
  }

  if (view === "verify") {
    return (
      <>
        <h1 className="text-lg font-semibold text-ink">Check your email</h1>
        <p className="mt-1 text-sm text-muted">
          We sent a 6-digit code to {emailValue.trim()}.
        </p>
        <form onSubmit={handleVerify} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Verification code</Label>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </div>
          {error && <ErrorNote message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify and continue
          </Button>
        </form>
        <button
          type="button"
          onClick={handleResend}
          className="mt-4 text-sm font-medium text-accent hover:text-accent-deep"
        >
          Resend code
        </button>
      </>
    );
  }

  return (
    <>
      {email && (
        <p className="mb-4 rounded-lg border border-border bg-paper px-3 py-2 text-center text-xs text-muted">
          Setting up the staff account for{" "}
          <span className="font-medium text-ink">{email}</span>
        </p>
      )}
      <h1 className="text-lg font-semibold text-ink">Create your staff account</h1>
      <p className="mt-1 text-sm text-muted">
        Use the invited email address and set your own password.
      </p>
      <form onSubmit={handleCreate} className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={(ev) => setFirstName(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              value={lastName}
              onChange={(ev) => setLastName(ev.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            readOnly={emailLocked}
            value={emailValue}
            onChange={(ev) => setEmailValue(ev.target.value)}
            className={emailLocked ? "bg-paper text-muted" : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(ev) => setConfirm(ev.target.value)}
          />
        </div>
        {error && <ErrorNote message={error} />}

        <div id="clerk-captcha" />

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="mt-5 text-xs text-muted">
        Already set up?{" "}
        <Link href="/login" className="font-medium text-accent hover:text-accent-deep">
          Sign in
        </Link>
      </p>
    </>
  );
}

function SignupInner() {
  const params = useSearchParams();
  const inviteEmail = params?.get("invite_email") ?? undefined;
  const inviteToken = params?.get("invite_token") ?? undefined;

  const [lookup, setLookup] = useState<InviteLookup | null>(null);
  const [checking, setChecking] = useState<boolean>(Boolean(inviteToken));

  // When the link carries a token, validate it so we can render the right state
  // (and use the canonical invited email, not whatever's in the URL).
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    setChecking(true);
    void (async () => {
      try {
        const res = await fetchApi(
          `/public/staff-invitation?token=${encodeURIComponent(inviteToken)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as InviteLookup;
        if (!cancelled) setLookup(data);
      } catch {
        // Network error — fall back to the email-only form rather than blocking.
        if (!cancelled) setLookup(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  // No token → legacy email-only link. Show the form as before.
  if (!inviteToken) {
    return (
      <Shell>
        <SignupForm email={inviteEmail} />
      </Shell>
    );
  }

  if (checking) {
    return (
      <Shell>
        <div className="py-2 text-center text-sm text-muted">Checking your invitation...</div>
      </Shell>
    );
  }

  // Lookup failed (network) — degrade to the email-only form.
  if (!lookup) {
    return (
      <Shell>
        <SignupForm email={inviteEmail} />
      </Shell>
    );
  }

  switch (lookup.status) {
    case "valid":
      return (
        <Shell>
          <SignupForm email={lookup.email ?? inviteEmail} />
        </Shell>
      );
    case "expired":
      return (
        <Shell>
          <InviteNotice
            title="This invitation has expired"
            body="Invitation links are valid for 7 days. Ask an admin to resend yours, then use the new link."
          />
        </Shell>
      );
    case "used":
      return (
        <Shell>
          <InviteNotice
            title="This invitation was already used"
            body="Your staff account is set up. Sign in with the email and password you created."
            showSignIn
          />
        </Shell>
      );
    case "revoked":
      return (
        <Shell>
          <InviteNotice
            title="This invitation was revoked"
            body="This invite is no longer valid. Contact an admin if you think this is a mistake."
          />
        </Shell>
      );
    case "not_found":
    default:
      return (
        <Shell>
          <InviteNotice
            title="Invalid invitation link"
            body="We couldn't find this invitation. Check that you used the full link from your email, or ask an admin to resend it."
          />
        </Shell>
      );
  }
}

export default function SignupPage() {
  // useSearchParams requires Suspense in app router builds.
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <SignupInner />
    </Suspense>
  );
}
