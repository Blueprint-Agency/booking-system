"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { answeredElsewhere, reportableFailure } from "@/lib/failed-read";
import { getPortalToken } from "@/lib/portal-auth";
import { reportError } from "@/lib/report-error";
import { useWorkspace } from "@/lib/workspace-context";
import {
  autoOpenDecision,
  autoOpenKey,
  heldSummary,
  rememberAutoOpenDecided,
  summaryUnchecked,
  wasAutoOpenDecided,
  type AttentionSummary,
  type HeldSummary,
} from "@/lib/attention";

/** How often the counts are re-read while the tab is in front. */
const POLL_MS = 60_000;

interface AttentionValue {
  summary: AttentionSummary | null;
  /** The bubble's number: open Needs-action items plus unread Updates. */
  total: number;
  /** The sidebar badge counts, scoped to the active workspace. */
  byGroup: AttentionSummary["by_group"];
  /**
   * The counts could not be read and there is no earlier answer to keep up. The
   * number is then unknown, not 0: the bell says so and no count is drawn.
   */
  unchecked: boolean;
  /** Re-read the counts now (after the panel is used, or an item is resolved). */
  refresh: () => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const EMPTY: AttentionValue = {
  summary: null,
  total: 0,
  byGroup: {},
  unchecked: false,
  refresh: () => {},
  panelOpen: false,
  setPanelOpen: () => {},
};

const AttentionContext = createContext<AttentionValue>(EMPTY);

/**
 * One reader of `/portal/attention/summary` per shell, above the sidebar, the
 * mobile drawer and the top bar, so all of them show one number from one fetch.
 *
 * It reads on mount, every minute while the tab is visible, when the tab comes
 * back into view or focus, and on every route change; and again when the
 * workspace changes, since `by_group` follows it. The first answer after a
 * sign-in may open the panel (`autoOpenDecision`).
 */
export function AttentionProvider({ children }: { children: ReactNode }) {
  const { api, currentStaff, activeLocationId } = useWorkspace();
  const pathname = usePathname();
  // The summary is held with the workspace it was read for: another workspace's
  // counts are never shown for this one (`heldSummary`).
  const [held, setHeld] = useState<HeldSummary | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // The workspace whose last read failed, or null once a read lands.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = activeLocationId ?? "";
  const summary = heldSummary(held, key);
  const decided = useRef(false);
  // The latest request wins: a slow answer for the workspace just left must not overwrite this one.
  const latest = useRef(0);

  const signedIn = Boolean(api && currentStaff);

  const read = useCallback(async () => {
    if (!api || !currentStaff) return;
    const mine = ++latest.current;
    try {
      const res = await api.get<AttentionSummary>(
        "/portal/attention/summary",
        activeLocationId ? { location_id: activeLocationId } : undefined,
      );
      if (mine !== latest.current) return;
      setHeld({ key: activeLocationId ?? "", summary: res });
      setFailedKey(null);
      if (!decided.current) {
        decided.current = true;
        const token = await getPortalToken();
        const store = typeof window === "undefined" ? null : safeSessionStorage();
        const key = token ? autoOpenKey(token) : null;
        const decision = autoOpenDecision({
          needsAction: res.needs_action,
          alreadyDecided: key ? wasAutoOpenDecided(store, key) : false,
        });
        if (decision.remember && key) rememberAutoOpenDecided(store, key);
        if (decision.open) setPanelOpen(true);
      }
    } catch (err) {
      // A missed poll leaves the last number up; the next one tries again. With
      // no number yet, the bell says it could not check rather than showing none.
      if (reportableFailure(err)) reportError(err, { scope: "attention-summary" });
      if (mine === latest.current && !answeredElsewhere(err)) setFailedKey(activeLocationId ?? "");
    }
  }, [api, currentStaff, activeLocationId]);

  // On mount, when the workspace changes, and on every route change.
  useEffect(() => {
    if (signedIn) void read();
  }, [signedIn, read, pathname]);

  // Every minute while visible; on return to the tab or focus.
  useEffect(() => {
    if (!signedIn) return;
    const tick = () => {
      if (!document.hidden) void read();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [signedIn, read]);

  const value = useMemo<AttentionValue>(
    () => ({
      summary,
      total: summary?.total ?? 0,
      byGroup: summary?.by_group ?? {},
      unchecked: summaryUnchecked(held, key, failedKey),
      refresh: () => void read(),
      panelOpen,
      setPanelOpen,
    }),
    [summary, held, key, failedKey, read, panelOpen],
  );

  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function useAttention(): AttentionValue {
  return useContext(AttentionContext);
}
