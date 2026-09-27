"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_DISPLAY_PREFS,
  DISPLAY_PREFS_KEY,
  applyDisplayPrefs,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";

const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_PREFS_KEY);
  } catch {
    return memoryRaw;
  }
}

// Storage blocked: the choice holds for the life of the tab.
let memoryRaw: string | null = null;

// `useSyncExternalStore` compares snapshots by identity, so the parsed value is
// kept until the stored string changes.
let cachedRaw: string | null | undefined;
let cached: DisplayPrefs = DEFAULT_DISPLAY_PREFS;

/** What this device has stored, parsed; the default when nothing is. */
export function readDisplayPrefs(): DisplayPrefs {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseDisplayPrefs(raw);
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab on this studio's app changed it: follow along.
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISPLAY_PREFS_KEY) {
      applyDisplayPrefs(document.documentElement, readDisplayPrefs());
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The member's display preferences on this device, and a setter that applies them at once. */
export function useDisplayPrefs(): [DisplayPrefs, (change: Partial<DisplayPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, readDisplayPrefs, () => DEFAULT_DISPLAY_PREFS);

  const update = useCallback((change: Partial<DisplayPrefs>) => {
    const next = { ...readDisplayPrefs(), ...change };
    const raw = JSON.stringify(next);
    memoryRaw = raw;
    try {
      window.localStorage.setItem(DISPLAY_PREFS_KEY, raw);
    } catch {
      // Kept in memory above.
    }
    applyDisplayPrefs(document.documentElement, next);
    for (const listener of listeners) listener();
  }, []);

  return [prefs, update];
}
