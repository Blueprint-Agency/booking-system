/**
 * The spinner in the middle of the screen: an accent ring turning over a small
 * card, so it reads above any page. `AppLoader` is the one place it is drawn,
 * and decides when it shows. Styles: `.page-loader` in `globals.css`.
 *
 * It never takes the pointer. While a navigation is under way (`navigating`)
 * the page being left fades out behind it (`globals.css`), so the spinner is
 * never drawn over a screen that looks finished.
 */
export function PageLoader({ state, navigating = false }: { state: "idle" | "loading"; navigating?: boolean }) {
  return (
    <div
      className="page-loader"
      data-state={state}
      data-navigating={navigating ? "true" : undefined}
      role="status"
      aria-live="polite"
    >
      <div className="page-loader__card">
        <span className="page-loader__ring" aria-hidden />
      </div>
      {state === "loading" && <span className="sr-only">Loading…</span>}
    </div>
  );
}
