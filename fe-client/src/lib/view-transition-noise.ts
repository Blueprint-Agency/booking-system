/**
 * Whether an error is only the browser declining to animate a page change.
 *
 * Every navigation here runs inside a View Transition
 * (`components/layout/page-transition.tsx`). When the tab is hidden, or the
 * viewport resizes mid-change, the browser skips the animation and rejects the
 * transition with an `InvalidStateError`. The page change itself still
 * happens. React means to ignore these, but matches the messages exactly, and
 * Chrome now appends a reason ("… invalid state. Document hidden"). So React
 * reports them as uncaught errors, and the dev overlay and telemetry pick them
 * up. These are React's own messages, matched as prefixes.
 */
const SKIPPED_TRANSITION_MESSAGES = [
  "View transition was skipped because document visibility state is hidden.",
  "Skipping view transition because document visibility state has become hidden.",
  "Skipping view transition because viewport size changed.",
  "Transition was aborted because of invalid state",
];

export function isSkippedViewTransition(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name !== "InvalidStateError" || typeof message !== "string") return false;
  return SKIPPED_TRANSITION_MESSAGES.some((known) => message.startsWith(known));
}
