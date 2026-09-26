"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

/**
 * Renders a dialog on `document.body`. A `fixed` overlay left where it is
 * declared shares its ancestors' stacking context — an animated page section
 * is one — so its z-index loses to the bottom tab bar however high it is set.
 */
export function Portal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  return isClient ? createPortal(children, document.body) : null;
}
