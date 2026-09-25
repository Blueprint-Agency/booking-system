/**
 * The loader in the middle of the screen: a ring that breathes in and out on a
 * calm, slow count, over a small card so it reads above any page. Used while
 * a navigation is on its way (`NavLoader`) and as the route's loading screen
 * (`(client)/loading.tsx`). Styles: `.page-loader` in `globals.css`.
 *
 * It never takes the pointer: the page under it stays usable.
 */
export function PageLoader({
  state = "loading",
  delayed = false,
}: {
  state?: "idle" | "loading" | "done";
  /** Appear a beat late, so a quick load shows nothing but the page. */
  delayed?: boolean;
}) {
  return (
    <div
      className={delayed ? "page-loader page-loader--delayed" : "page-loader"}
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <div className="page-loader__card">
        <span className="page-loader__ring" aria-hidden />
        <span className="page-loader__dot" aria-hidden />
      </div>
      {state === "loading" && <span className="sr-only">Loading…</span>}
    </div>
  );
}
