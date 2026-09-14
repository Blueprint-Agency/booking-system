// fe-client/src/components/impersonation-banner.tsx
import { cookies } from "next/headers";
import { IMPERSONATION_GRANT_COOKIE } from "@/lib/impersonation-handoff";
import { StopImpersonatingButton } from "./stop-impersonating-button";

/**
 * Server component banner. Renders nothing when the impersonation cookie is
 * absent. When present, pins a red bar to the top of the viewport with a
 * "Stop impersonating" action (`StopImpersonatingButton`).
 *
 * The cookie is opaque to us here — we only check presence.
 * The actual client name surfaces from the page-level header data that's
 * already fetched; we keep the banner self-contained and don't fetch /me here.
 */
export async function ImpersonationBanner() {
  const jar = await cookies();
  const active = jar.has(IMPERSONATION_GRANT_COOKIE);
  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] flex h-10 items-center justify-center gap-2 px-3 bg-warning text-xs sm:text-sm font-medium text-ink shadow-sm"
    >
      {/* The full sentence does not fit beside the button on a phone, and the
          bar is a fixed 40px, so the short form carries it there. */}
      <span className="truncate">
        <span className="sm:hidden">Impersonating a client.</span>
        <span className="hidden sm:inline">You are impersonating a client.</span>
      </span>
      <StopImpersonatingButton />
    </div>
  );
}
