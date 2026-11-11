"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { answeredElsewhere } from "@/lib/failed-read";
import { useWorkspace } from "@/lib/workspace-context";
import {
  scheduleEntryFromApi,
  type ApiScheduleEntry,
  type ScheduleEntry,
  type ScheduleKind,
} from "@/lib/schedule-entry";

export type { ApiScheduleEntry, ScheduleEntry, ScheduleKind };

export interface ScheduleFilters {
  from?: string;
  to?: string;
  type?: ScheduleKind;
  instructorId?: string;
  classTypeId?: string;
  locationId?: string;
}

/**
 * Whose timetable: the Admin's is the studio's, narrowed by the filters; the
 * Instructor's is the caller's own, and the backend ignores the narrowing.
 */
const TIMETABLE_PATH = {
  admin: "/portal/admin/schedule",
  instructor: "/portal/instructor/schedule",
} as const;

export function useSchedule(
  filters: ScheduleFilters,
  opts: {
    surface?: keyof typeof TIMETABLE_PATH;
    /** False holds the read back, e.g. until the timetable knows which week it is on. */
    enabled?: boolean;
  } = {},
) {
  const { api } = useWorkspace();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to, type, instructorId, classTypeId, locationId } = filters;
  const path = TIMETABLE_PATH[opts.surface ?? "admin"];
  const enabled = opts.enabled ?? true;

  const load = useCallback(async () => {
    if (!api || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | undefined> = {
        from,
        to,
        type,
        instructor_id: instructorId,
        class_type_id: classTypeId,
        location_id: locationId,
      };
      const res = await api.get<{ entries: ApiScheduleEntry[] }>(path, query);
      setEntries(res.entries.map(scheduleEntryFromApi));
    } catch (err) {
      // A `401` ends the session (`lib/session-expiry.ts`) and the shell sends
      // the person to sign in; maintenance puts up the maintenance screen. Both
      // replace this page, so no failure is drawn for them.
      if (!answeredElsewhere(err)) {
        setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [api, enabled, path, from, to, type, instructorId, classTypeId, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entries, loading, error, reload: load };
}
