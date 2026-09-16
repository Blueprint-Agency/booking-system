// fe-client/src/components/impersonation-banner.tsx
import { cookies } from "next/headers";

/**
 * Server component banner. Renders nothing when the impersonation cookie is
 * absent. When present, pins a red bar to the top of the viewport with a
 * "Stop impersonating" action that posts to /stop-impersonating.
 *
 * The cookie itself is httpOnly (and opaque to us — we only check presence).
 * The actual client name surfaces from the page-level header data that's
 * already fetched; we keep the banner self-contained and don't fetch /me here.
 */
export async function ImpersonationBanner() {
  const jar = await cookies();
  const active = jar.has("__imp_grant");
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
      <form action="/stop-impersonating" method="post" className="shrink-0">
        <button
          type="submit"
          className="whitespace-nowrap rounded-full border border-ink/30 px-3 py-1 text-xs font-semibold text-ink hover:bg-ink/10 transition-colors"
        >
          Stop
          <span className="hidden sm:inline"> impersonating</span>
        </button>
      </form>
    </div>
  );
}
