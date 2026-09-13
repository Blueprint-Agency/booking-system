"use client";
/**
 * Accept a staff invitation: choose a password, and arrive signed in (#115).
 *
 * There is no open sign-up. Every staff account was already written by the
 * invitation — the auth user and the staff row — and this page is where the
 * invitee turns the link in their email into a password. The link's token is
 * the proof they are who was invited; the backend checks it, sets the password
 * and activates the row, and the page signs in with the password just chosen.
 *
 * Someone who already has a password here — staff at another studio, one
 * account — keeps it: accepting just opens this studio to it, and they sign in
 * as they always do.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { AuthShell, ErrorNote } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { refusalCode } from "@/lib/access-refusal";
import { fetchApi } from "@/lib/api-url";
import { staffAuth } from "@/lib/staff-auth";

type InviteStatus = "valid" | "expired" | "used" | "revoked" | "not_found";
interface InviteLookup {
  status: InviteStatus;
  email: string | null;
  role: string | null;
  password_set: boolean;
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

/** A refused acceptance, in words. */
function acceptError(status: number, body: unknown): string {
  switch (refusalCode(body)) {
    case "invitation_expired":
      return "This invitation has expired. Ask an admin to resend it, then use the new link.";
    case "invitation_used":
      return "This invitation was already used. Sign in with the password you chose.";
    case "invitation_revoked":
    case "invitation_not_found":
      return "This invitation is no longer valid. Ask an admin if you think this is a mistake.";
    case "password_too_short":
      return "Password must be at least 8 characters.";
    case "password_too_long":
      return "Password must be at most 128 characters.";
    default:
      return status === 429
        ? "Too many attempts. Wait a minute, then try again."
        : "We couldn't set up your account. Please try again.";
  }
}

async function postAccept(body: Record<string, string>): Promise<string | null> {
  const res = await fetchApi("/public/staff-invitation/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.ok) return null;
  const parsed: unknown = await res.json().catch(() => null);
  return acceptError(res.status, parsed);
}

function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
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

    setSubmitting(true);
    try {
      const refused = await postAccept({
        token,
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      if (refused) {
        setError(refused);
        return;
      }
      const { error: signInErr } = await staffAuth.signIn.email({ email, password });
      // The account is set up either way; if signing in did not follow, the
      // login page is one step away with the password they just chose.
      router.replace(signInErr ? "/login" : "/admin");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="mb-4 rounded-lg border border-border bg-paper px-3 py-2 text-center text-xs text-muted">
        Setting up the staff account for <span className="font-medium text-ink">{email}</span>
      </p>
      <h1 className="text-lg font-semibold text-ink">Create your staff account</h1>
      <p className="mt-1 text-sm text-muted">Choose the password you&apos;ll sign in with.</p>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={ev => setFirstName(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              value={lastName}
              onChange={ev => setLastName(ev.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" readOnly value={email} className="bg-paper text-muted" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={ev => setPassword(ev.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={ev => setConfirm(ev.target.value)}
          />
        </div>
        {error && <ErrorNote message={error} />}
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

function ExistingAccountForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      const refused = await postAccept({ token });
      if (refused) {
        setError(refused);
        return;
      }
      router.replace("/login");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="text-center">
      <h1 className="text-base font-semibold text-ink">You already have a staff account</h1>
      <p className="mt-2 text-sm text-muted">
        <span className="font-medium text-ink">{email}</span> already has a password. Accept the
        invitation, then sign in with it as usual.
      </p>
      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}
      <Button onClick={() => void handleAccept()} disabled={submitting} className="mt-4 w-full">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Accept and sign in
      </Button>
    </div>
  );
}

function SignupInner() {
  const params = useSearchParams();
  const inviteToken = params?.get("invite_token") ?? null;

  const [lookup, setLookup] = useState<InviteLookup | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchApi(
          `/public/staff-invitation?token=${encodeURIComponent(inviteToken)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`lookup ${res.status}`);
        const data = (await res.json()) as InviteLookup;
        if (!cancelled) setLookup(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  // No token: there is no account to set up without an invitation.
  if (!inviteToken) {
    return (
      <InviteNotice
        title="Staff accounts are invite-only"
        body="Open the link in your invitation email to set up your account. If you don't have one, ask a studio admin to invite you."
        showSignIn
      />
    );
  }

  if (failed) {
    return (
      <InviteNotice
        title="We couldn't check your invitation"
        body="Check your connection and reload this page."
      />
    );
  }

  if (!lookup) {
    return <div className="py-2 text-center text-sm text-muted">Checking your invitation...</div>;
  }

  switch (lookup.status) {
    case "valid":
      return lookup.password_set ? (
        <ExistingAccountForm token={inviteToken} email={lookup.email ?? ""} />
      ) : (
        <SetPasswordForm token={inviteToken} email={lookup.email ?? ""} />
      );
    case "expired":
      return (
        <InviteNotice
          title="This invitation has expired"
          body="Invitation links are valid for 7 days. Ask an admin to resend yours, then use the new link."
        />
      );
    case "used":
      return (
        <InviteNotice
          title="This invitation was already used"
          body="Your staff account is set up. Sign in with the email and password you created."
          showSignIn
        />
      );
    case "revoked":
      return (
        <InviteNotice
          title="This invitation was revoked"
          body="This invite is no longer valid. Contact an admin if you think this is a mistake."
        />
      );
    case "not_found":
    default:
      return (
        <InviteNotice
          title="Invalid invitation link"
          body="We couldn't find this invitation. Check that you used the full link from your email, or ask an admin to resend it."
        />
      );
  }
}

export default function SignupPage() {
  // useSearchParams requires Suspense in app router builds.
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <AuthShell>
        <SignupInner />
      </AuthShell>
    </Suspense>
  );
}
