/**
 * The spinner in the middle of the screen: an accent ring turning over a small
 * card, so it reads above any page. `AppLoader` is the one place it is drawn,
 * and decides when it shows. Styles: `.page-loader` in `globals.css`.
 *
 * It never takes the pointer: the page under it stays usable.
 */
export function PageLoader({ state }: { state: "idle" | "loading" }) {
  return (
    <div className="page-loader" data-state={state} role="status" aria-live="polite">
      <div className="page-loader__card">
        <span className="page-loader__ring" aria-hidden />
      </div>
      {state === "loading" && <span className="sr-only">Loading…</span>}
    </div>
  );
}
