"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type InviteStatus = "valid" | "expired" | "used" | "revoked" | "not_found";
interface InviteLookup {
  status: InviteStatus;
  email: string | null;
  role: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-8 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-base font-bold text-white shadow-soft">
            YS
          </span>
          <div className="text-lg font-semibold tracking-tight text-ink">
            Yoga Sadhana
            <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Staff
            </span>
          </div>
        </div>
        {children}
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
    <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-soft">
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

function SignupForm({ email }: { email?: string }) {
  return (
    <>
      {email && (
        <p className="mb-4 rounded-lg border border-border bg-card px-3 py-2 text-center text-xs text-muted">
          Setting up the staff account for{" "}
          <span className="font-medium text-ink">{email}</span>
        </p>
      )}
      <div className="flex justify-center">
        <SignUp
          routing="hash"
          signInUrl="/login"
          initialValues={email ? { emailAddress: email } : undefined}
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "rounded-2xl border border-border bg-card shadow-soft",
            },
          }}
        />
      </div>
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
        const res = await fetch(
          `${API_BASE}/api/v1/public/staff-invitation?token=${encodeURIComponent(inviteToken)}`,
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
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted shadow-soft">
          Checking your invitation…
        </div>
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
