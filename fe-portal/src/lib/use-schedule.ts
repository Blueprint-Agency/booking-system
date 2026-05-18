"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import type { EventState } from "@/types";

export type ScheduleKind = "class" | "workshop" | "pt";

export interface ApiScheduleEntry {
  kind: ScheduleKind;
  id: string;
  workshop_id: string | null;
  label: string;
  class_type_id: string | null;
  instructor_ids: string[];
  location_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  event_state: EventState;
  day_index: number | null;
  day_count: number | null;
}

/**
 * Shape consumed by the schedule UI. Mirrors the legacy
 * `buildScheduleEntries()` return shape so the calendar renderer stays
 * untouched while we swap data sources. `raw` only carries what the renderer
 * needs (the workshop link uses `raw.id` for workshops).
 */
export type ScheduleEntry =
  | {
      kind: "class";
      id: string;
      label: string;
      classTypeId: string;
      instructorIds: string[];
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: { id: string };
    }
  | {
      kind: "workshop";
      id: string;
      label: string;
      classTypeId: string;
      instructorIds: string[];
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: { id: string };
      dayIndex: number;
      dayCount: number;
    }
  | {
      kind: "pt";
      id: string;
      label: string;
      classTypeId: null;
      instructorIds: string[];
      locationId: string | null;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: { id: string };
    };

export interface ScheduleFilters {
  from?: string;
  to?: string;
  type?: ScheduleKind;
  instructorId?: string;
  classTypeId?: string;
  locationId?: string;
}

function fromApi(e: ApiScheduleEntry): ScheduleEntry {
  if (e.kind === "class") {
    return {
      kind: "class",
      id: e.id,
      label: e.label,
      classTypeId: e.class_type_id ?? "",
      instructorIds: e.instructor_ids,
      locationId: e.location_id ?? "",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      capacity: e.capacity,
      bookedCount: e.booked_count,
      eventState: e.event_state,
      raw: { id: e.id },
    };
  }
  if (e.kind === "workshop") {
    return {
      kind: "workshop",
      id: e.id,
      label: e.label,
      classTypeId: e.class_type_id ?? "",
      instructorIds: e.instructor_ids,
      locationId: e.location_id ?? "",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      capacity: e.capacity,
      bookedCount: e.booked_count,
      eventState: e.event_state,
      raw: { id: e.workshop_id ?? e.id },
      dayIndex: e.day_index ?? 1,
      dayCount: e.day_count ?? 1,
    };
  }
  return {
    kind: "pt",
    id: e.id,
    label: e.label,
    classTypeId: null,
    instructorIds: e.instructor_ids,
    locationId: e.location_id,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    capacity: e.capacity,
    bookedCount: e.booked_count,
    eventState: e.event_state,
    raw: { id: e.id },
  };
}

export function useSchedule(filters: ScheduleFilters) {
  const { api } = useWorkspace();
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to, type, instructorId, classTypeId, locationId } = filters;

  const load = useCallback(async () => {
    if (!api) return;
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
      const res = await api.get<{ entries: ApiScheduleEntry[] }>(
        "/portal/admin/schedule",
        query,
      );
      setEntries(res.entries.map(fromApi));
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [api, from, to, type, instructorId, classTypeId, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entries, loading, error, reload: load };
}
