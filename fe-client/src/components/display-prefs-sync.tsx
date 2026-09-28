"use client";

import { useLayoutEffect } from "react";
import { applyDisplayPrefs } from "@/lib/display-prefs";
import { readDisplayPrefs, useDisplayPrefs } from "@/lib/use-display-prefs";

/**
 * Holds `<html>` to the member's display preferences once React is running.
 *
 * The inline head script (`DISPLAY_PREFS_SCRIPT`) has already set them for the
 * first paint; this is for what comes after. In development Strict Mode's
 * remount resets `<html>` to the attributes JSX gives it, clearing the
 * script's, and a change in another tab arrives here too.
 */
export function DisplayPrefsSync() {
  const prefs = useDisplayPrefs();
  useLayoutEffect(() => {
    // Read from storage rather than `prefs`: while hydrating, the hook hands
    // back the server's default, and applying that would flash light theme.
    applyDisplayPrefs(document.documentElement, readDisplayPrefs());
  }, [prefs]);
  return null;
}
