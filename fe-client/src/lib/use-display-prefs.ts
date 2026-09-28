"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_DISPLAY_PREFS,
  DISPLAY_PREFS_KEY,
  applyDisplayPrefs,
  fromAccountDisplayPrefs,
  parseDisplayPrefs,
  type AccountDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";
import type { Api } from "@/lib/api";

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

/** Store a change on this device and apply it at once. */
function writeDisplayPrefs(change: Partial<DisplayPrefs>): void {
  const current = readDisplayPrefs();
  const next = { ...current, ...change };
  if (next.theme === current.theme && next.fontSize === current.fontSize) return;
  const raw = JSON.stringify(next);
  memoryRaw = raw;
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, raw);
  } catch {
    // Kept in memory above.
  }
  applyDisplayPrefs(document.documentElement, next);
  for (const listener of listeners) listener();
}

/** The member's display preferences on this device. `pickDisplayPrefs` changes them. */
export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, readDisplayPrefs, () => DEFAULT_DISPLAY_PREFS);
}

// ── The account's copy ──────────────────────────────────────────────────────
//
// A pick is the device's until the account has it. While a save is owed, this
// flag is set, and the account's (older) value never overwrites the device's:
// the next profile read pushes the device's value instead. Kept beside the
// value, so a reload before the save lands still owes it.

const UNSYNCED_KEY = `${DISPLAY_PREFS_KEY}.unsynced`;

function setUnsynced(unsynced: boolean): void {
  try {
    if (unsynced) window.localStorage.setItem(UNSYNCED_KEY, "1");
    else window.localStorage.removeItem(UNSYNCED_KEY);
  } catch {
    // Storage blocked: the tab's own pick stands until it closes.
  }
}

function isUnsynced(): boolean {
  try {
    return window.localStorage.getItem(UNSYNCED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Bumped by every pick, so a read begun before one can tell it is stale. */
let picks = 0;
export function displayPrefsPicks(): number {
  return picks;
}

// Saves go one at a time, each sending both fields as they stand when it
// leaves, so the last pick is the last write whatever order replies arrive in.
let saving: Promise<unknown> = Promise.resolve();

function pushToAccount(api: Api): Promise<boolean> {
  const next = saving.then(async () => {
    const at = picks;
    const { theme, fontSize } = readDisplayPrefs();
    try {
      await api.patch("/me/display-prefs", { theme, font_size: fontSize });
    } catch {
      return false;
    }
    // A pick made while this was in flight is still owed; its own save follows.
    if (at === picks) setUnsynced(false);
    return true;
  });
  saving = next;
  return next;
}

/** A member's pick on the settings page: applied now, then saved to the account. */
export function pickDisplayPrefs(api: Api, change: Partial<DisplayPrefs>): Promise<boolean> {
  picks++;
  writeDisplayPrefs(change);
  setUnsynced(true);
  return pushToAccount(api);
}

/**
 * The account's choice, from the profile read after sign-in. A save still owed
 * from this device wins, and goes up instead; otherwise the account's choice
 * is applied here. `picksAtRead` is `displayPrefsPicks()` when the read began:
 * a pick since then is newer than what the read carries.
 */
export function adoptAccountDisplayPrefs(
  api: Api,
  account: AccountDisplayPrefs | undefined,
  picksAtRead: number,
): void {
  if (picksAtRead !== picks) return;
  if (isUnsynced()) {
    void pushToAccount(api);
    return;
  }
  writeDisplayPrefs(fromAccountDisplayPrefs(account));
}
