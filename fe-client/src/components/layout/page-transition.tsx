import { ViewTransition, type ReactNode } from "react";

/**
 * How a page arrives. Used by the route templates (`(client)/template.tsx`,
 * `(client)/account/template.tsx`), which remount on every navigation between
 * their child segments — so switching account tabs animates the panel, not the
 * account menu beside it, and the header and tab bar never move.
 *
 * Two layers, both quiet:
 *  - On a navigation the browser's View Transition fades the old page out
 *    (`page` class, `globals.css`). Where it is unsupported the old page simply
 *    goes, as before.
 *  - The new page rises in with `.page-enter` — the same on a first load, which
 *    no navigation precedes.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="page" enter="none" default="none">
      <div className="page-enter">{children}</div>
    </ViewTransition>
  );
}
