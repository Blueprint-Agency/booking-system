"use client";

import { cn } from "@/lib/utils";
import { useHoldLoader } from "@/lib/loading-store";

/**
 * Where content will be once it has loaded. It draws nothing — the app's one
 * centred spinner (`AppLoader`) shows while any of these is mounted — and only
 * holds the space, so the page doesn't collapse and then jump when the content
 * arrives. Size it to roughly what is coming.
 */
export function ContentLoading({ label, className }: { label: string; className?: string }) {
  useHoldLoader();
  return <div aria-busy="true" aria-label={label} className={cn("min-h-[40vh]", className)} />;
}
