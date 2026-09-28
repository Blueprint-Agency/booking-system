"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Renders a dialog on `document.body`. A `fixed` overlay left where it is
 * declared shares its ancestors' stacking context — an animated page section
 * is one — so its z-index loses to the bottom tab bar however high it is set.
 */
export function Portal({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return hydrated ? createPortal(children, document.body) : null;
}
