"use client";
/**
 * Confirm a new staff sign-in email: where the link mailed to an Unverified
 * address lands.
 *
 * An admin saved the address in the staff dialog; the portal shows it as
 * Unverified, and the old address keeps signing in, until this page's button is
 * pressed. Holding the link is the proof, so nobody need be signed in. The
 * click is asked for rather than taken on load, so a mail scanner that opens
 * links cannot confirm one.
 */
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { AuthShell, ErrorNote } from "@/components/auth/auth-card";
import { refusalCode } from "@/lib/access-refusal";
import { fetchApi } from "@/lib/api-url";

type LinkStatus = "valid" | "expired" | "invalid";
interface LinkLookup {
  status: LinkStatus;
  email: string | null;
}

function Notice({ title, body, showSignIn }: { title: string; body: React.ReactNode; showSignIn?: boolean }) {
  return (
    <div className="text-center">
      <h1 className="text-base font-semibold text-ink">{title}</h1>
      <p className="mt-2 break-words text-sm text-muted">{body}</p>
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

const EXPIRED_BODY = "Confirmation links work for 24 hours. Ask a studio admin to send a new one.";
const INVALID_BODY =
  "This link was already used, replaced by a newer one, or revoked. If your email still needs confirming, ask a studio admin to send a new link.";

/** A refused confirmation, in words. */
function confirmError(status: number, body: unknown): string {
  switch (refusalCode(body)) {
    case "email_change_link_expired":
      return EXPIRED_BODY;
    case "email_change_link_invalid":
      return INVALID_BODY;
    case "email_in_use":
      return "Another staff member of this studio already signs in with this email. Ask a studio admin.";
    case "staff_archived":
      return "This staff account is blocked, so its email can't be changed. Ask a studio admin.";
    default:
      return status === 429
        ? "Too many attempts. Wait a minute, then try again."
        : "We couldn't confirm your email. Please try again.";
  }
}

function ConfirmForm({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetchApi("/public/staff-email-change/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { email: string };
        setConfirmed(data.email);
        return;
      }
      setError(confirmError(res.status, await res.json().catch(() => null)));
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <Notice
        title="Email confirmed"
        body={
          <>
            You now sign in with <span className="font-medium text-ink">{confirmed}</span>. Your password is
            unchanged.
          </>
        }
        showSignIn
      />
    );
  }

  return (
    <div className="text-center">
      <h1 className="text-base font-semibold text-ink">Confirm your new email</h1>
      <p className="mt-2 break-words text-sm text-muted">
        Confirm <span className="font-medium text-ink">{email}</span> as the email you sign in to the staff portal
        with. Your password stays the same.
      </p>
      {error && (
        <div className="mt-4 text-left">
          <ErrorNote message={error} />
        </div>
      )}
      <Button onClick={() => void handleConfirm()} disabled={submitting} className="mt-4 w-full">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Confirm email
      </Button>
    </div>
  );
}

function ConfirmEmailInner() {
  const params = useSearchParams();
  const token = params?.get("token") ?? null;

  const [lookup, setLookup] = useState<LinkLookup | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchApi(`/public/staff-email-change?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`lookup ${res.status}`);
        const data = (await res.json()) as LinkLookup;
        if (!cancelled) setLookup(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return <Notice title="Invalid confirmation link" body="Open the full link from your email." />;
  }
  if (failed) {
    return <Notice title="We couldn't check your link" body="Check your connection and reload this page." />;
  }
  if (!lookup) {
    return <div className="py-2 text-center text-sm text-muted">Checking your link...</div>;
  }

  switch (lookup.status) {
    case "valid":
      return <ConfirmForm token={token} email={lookup.email ?? ""} />;
    case "expired":
      return <Notice title="This link has expired" body={EXPIRED_BODY} />;
    case "invalid":
    default:
      return <Notice title="This link no longer works" body={INVALID_BODY} showSignIn />;
  }
}

export default function ConfirmEmailPage() {
  // useSearchParams requires Suspense in app router builds.
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <AuthShell>
        <ConfirmEmailInner />
      </AuthShell>
    </Suspense>
  );
}
