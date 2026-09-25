"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMemberSession } from "@/lib/member-auth";
import { useFocusTrap } from "@/lib/use-focus-trap";

type AuthGateContext = "buy a package" | "buy merch" | "book a class" | "book a workshop" | "book a private session" | "continue";

function LoginRequiredModal({
  open,
  onClose,
  context,
  nextHref,
}: {
  open: boolean;
  onClose: () => void;
  context: AuthGateContext;
  nextHref: string;
}) {
  const [mounted, setMounted] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open && mounted);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const loginHref = `/login?next=${encodeURIComponent(nextHref)}`;
  const registerHref = `/register?next=${encodeURIComponent(nextHref)}`;

  return createPortal(
    <div
      // A bottom sheet on a phone — the actions land under the thumb — and a
      // centred dialog from `sm` up.
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-ink/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in required"
        tabIndex={-1}
        className="w-full sm:max-w-md max-h-[85dvh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-2xl shadow-modal p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-8 outline-none animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent-deep"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink mb-2">
          Please log in to {context}
        </h2>
        <p className="text-sm text-muted mb-6 leading-relaxed">
          You need an account to {context}. Log in to continue, or create an account in under a minute.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Link
            href={loginHref}
            className="flex-1 inline-flex min-h-[48px] items-center justify-center px-4 py-2.5 text-sm font-bold text-inverse bg-accent rounded-full hover:bg-accent-deep transition-colors"
          >
            Log in
          </Link>
          <Link
            href={registerHref}
            className="flex-1 inline-flex min-h-[48px] items-center justify-center px-4 py-2.5 text-sm font-bold text-ink border border-ink/10 rounded-full hover:bg-warm transition-colors"
          >
            Sign up
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full min-h-[44px] text-center text-sm text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

export function useAuthGate(context: AuthGateContext = "continue") {
  const { isSignedIn } = useMemberSession();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string>("/");

  const isAuthed = !!isSignedIn;

  const requireAuth = useCallback(
    (href: string, onProceed?: () => void) => {
      if (!isAuthed) {
        setPendingHref(href);
        setModalOpen(true);
        return false;
      }
      if (onProceed) onProceed();
      else router.push(href);
      return true;
    },
    [isAuthed, router]
  );

  const gate = (
    <LoginRequiredModal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      context={context}
      nextHref={pendingHref}
    />
  );

  return { isAuthed, requireAuth, gate };
}
