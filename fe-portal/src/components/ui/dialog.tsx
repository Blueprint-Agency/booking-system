"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 animate-fade-in sm:p-4">
      <div
        className="absolute inset-0 bg-overlay"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        // dvh, not vh: on mobile Safari the URL bar eats into vh, so a vh-sized
        // dialog puts its own footer under the browser chrome.
        className={cn(
          "relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-xl bg-card shadow-modal animate-fade-up sm:max-h-[calc(100dvh-2rem)]",
          className
        )}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="absolute right-2 top-2 rounded-md p-2 text-muted hover:bg-paper hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
        {(title || description) && (
          // pr-10 keeps the heading clear of the close button on a narrow screen.
          <div className="px-4 pr-10 pt-5 sm:px-6 sm:pr-12 sm:pt-6">
            {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4 sm:px-6 sm:pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  // Stacked and full-width on a phone (primary action on top, thumb-reachable),
  // right-aligned inline from sm up.
  return (
    <div
      className={cn(
        "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
        className
      )}
    >
      {children}
    </div>
  );
}
