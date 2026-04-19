"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMockState } from "@/lib/mock-state";

type AuthGateContext = "buy a package" | "book a class" | "book a workshop" | "book a private session" | "continue";

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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in required"
        className="w-full max-w-md bg-paper rounded-xl shadow-hover p-6 sm:p-8"
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
        <h2 className="text-xl sm:text-2xl font-serif text-ink mb-2">
          Please log in to {context}
        </h2>
        <p className="text-sm text-muted mb-6 leading-relaxed">
          You need an account to {context}. Log in to continue, or create an account in under a minute.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Link
            href={loginHref}
            className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-sm font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors"
          >
            Log in
          </Link>
          <Link
            href={registerHref}
            className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-sm font-bold text-ink border border-ink/15 rounded-md hover:bg-warm transition-colors"
          >
            Sign up
          </Link>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full text-center text-xs text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

export function useAuthGate(context: AuthGateContext = "continue") {
  const state = useMockState();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string>("/");

  const isAuthed = !!state.user;

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

type GatedLinkProps = {
  href: string;
  context: AuthGateContext;
  className?: string;
  children: React.ReactNode;
  onAuthedClick?: () => void;
};

export function GatedLink({ href, context, className, children, onAuthedClick }: GatedLinkProps) {
  const { isAuthed, requireAuth, gate } = useAuthGate(context);

  if (isAuthed) {
    return (
      <>
        <Link href={href} className={className} onClick={onAuthedClick}>
          {children}
        </Link>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.preventDefault();
          requireAuth(href);
        }}
      >
        {children}
      </button>
      {gate}
    </>
  );
}
