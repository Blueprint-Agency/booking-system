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
    <div className="fixed top-0 left-0 right-0 z-[60] flex h-10 items-center justify-center gap-3 bg-amber-500 text-sm font-medium text-amber-950 shadow-sm">
      <span>You are impersonating a client.</span>
      <form action="/stop-impersonating" method="post">
        <button
          type="submit"
          className="rounded border border-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-950 hover:bg-amber-900/10"
        >
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
