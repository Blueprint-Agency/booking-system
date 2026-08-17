"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function PayButton({
  onClick,
  busy,
  disabled,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "w-full rounded-full bg-ink text-paper py-4 text-sm font-semibold transition-colors",
        busy || disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-ink/90",
      )}
    >
      {busy ? (
        <span className="inline-flex items-center gap-2 justify-center">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Redirecting to payment…
        </span>
      ) : (
        label
      )}
    </button>
  );
}

export function StripeFootnote() {
  return (
    <p className="text-xs text-muted text-center flex items-center justify-center gap-1.5">
      <Lock className="h-3 w-3" />
      Secured by Stripe · All prices in SGD
    </p>
  );
}
