"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { cancelledNotice } from "@/lib/checkout-return";
import { cn } from "@/lib/utils";

/**
 * The banner a checkout's cancel return lands on (#274) — the account page (a
 * standalone Add-On, or paying more towards an unfinished purchase) and merch.
 * Renders nothing on an ordinary visit.
 *
 * Wrapped in its own Suspense because it reads the query string, so the page
 * around it can still prerender.
 */
export function CancelledBanner({ className }: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <Banner className={className} />
    </Suspense>
  );
}

function Banner({ className }: { className?: string }) {
  const notice = cancelledNotice(useSearchParams());
  if (!notice) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink",
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <span>{notice}</span>
    </div>
  );
}
