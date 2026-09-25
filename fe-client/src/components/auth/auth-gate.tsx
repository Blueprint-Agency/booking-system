"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMemberSession } from "@/lib/member-auth";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn } from "@/lib/utils";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";

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
    // Above the page's own sheets: a sheet can open the sign-in prompt.
    <div className={cn(SHEET_BACKDROP, "z-[100]")} onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-gate-title"
        tabIndex={-1}
        className={SHEET_PANEL}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className={SHEET_HANDLE} />
        <h2 id="auth-gate-title" className={SHEET_TITLE}>
          Log in to {context}
        </h2>
        <p className={SHEET_TEXT}>You need an account to {context}.</p>
        <div className={SHEET_ACTIONS}>
          <Link href={registerHref} className={BTN_SECONDARY}>
            Sign up
          </Link>
          <Link href={loginHref} className={BTN_PRIMARY}>
            Log in
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full min-h-[44px] text-center text-sm font-semibold text-muted hover:text-ink transition-colors"
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
