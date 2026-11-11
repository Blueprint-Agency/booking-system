"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudioZone } from "@/components/brand/brand-provider";
import { localDay } from "@/lib/local-day";
import type { GridView } from "@/lib/schedule-grid";
import {
  openingPosition,
  parseStoredPosition,
  positionFromSearch,
  positionSearch,
  type SchedulePosition,
} from "@/lib/schedule-position";

/**
 * The day and view a timetable is on, kept in its address and in the tab's
 * session storage under `storageKey` so coming back to it lands where staff
 * left it (`schedule-position.ts`).
 *
 * The position is only known on the client, so it settles in an effect after
 * the first paint; `ready` says when, and the timetable waits for it before
 * asking for a week, so it never fetches this week only to jump away.
 */
export function useSchedulePosition(storageKey: string) {
  const today = localDay(useStudioZone());
  const [pos, setPos] = useState<SchedulePosition>({ date: today, view: "week" });
  const [ready, setReady] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    let stored: SchedulePosition | null = null;
    try {
      stored = parseStoredPosition(window.sessionStorage.getItem(storageKey));
    } catch {
      // Storage blocked (a private window, site data refused): open as new.
    }
    setPos(
      openingPosition({
        fromAddress: positionFromSearch(window.location.search),
        stored,
        today,
        phone: window.matchMedia("(max-width: 639px)").matches,
      }),
    );
    setReady(true);
  }, [storageKey, today]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {
      // Not kept for the tab; the address still carries it.
    }
    const search = positionSearch(pos);
    // The native History API, which Next's router follows without a fetch, so
    // stepping a week does not reload the page.
    if (window.location.search !== search) {
      window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    }
  }, [pos, ready, storageKey]);

  const setDate = useCallback((date: string) => setPos((p) => ({ ...p, date })), []);
  const setView = useCallback((view: GridView) => setPos((p) => ({ ...p, view })), []);
  const open = useCallback((date: string, view: GridView) => setPos({ date, view }), []);

  return { cursor: pos.date, view: pos.view, today, ready, setDate, setView, open };
}
