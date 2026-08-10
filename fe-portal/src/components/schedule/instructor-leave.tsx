"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import type { CatalogInstructor } from "@/lib/catalog";

/**
 * "Who is away on this date" for the instructor pickers on the scheduling
 * screens — class create/edit, PT scheduling/edit, corporate scheduling/edit.
 *
 * This is a HINT, never the enforcement. The backend refuses an assignment that
 * lands on pending or approved leave (services/schedule/occupancy), and it does
 * so whatever this screen last managed to fetch. So a failed load is silently an
 * empty map: showing an error for a hint would be noise, and the save is still
 * safe. Equally, a full-day option is disabled only to save the admin a pointless
 * round trip — nothing here decides anything.
 *
 * Reads the all-staff `GET /portal/leave-calendar` with from == to == the chosen
 * date. Nothing leave-specific is added to the backend for the picker.
 */

type HalfDay = "none" | "morning" | "afternoon";

/** Instructor id → the shape of their absence on the queried date. Absent = free. */
export type InstructorLeave = ReadonlyMap<string, HalfDay>;

const NO_LEAVE: InstructorLeave = new Map();

/** `date` is `YYYY-MM-DD`, or "" before the admin has picked one — nobody is
 *  greyed until there is a date to be away on. */
export function useInstructorsOnLeave(date: string): InstructorLeave {
  const { api } = useWorkspace();
  const [onLeave, setOnLeave] = useState<InstructorLeave>(NO_LEAVE);

  useEffect(() => {
    if (!api || !date) {
      setOnLeave(NO_LEAVE);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{
          leave: { instructor: { id: string }; half_day: HalfDay }[];
        }>("/portal/leave-calendar", { from: date, to: date });
        if (cancelled) return;
        const map = new Map<string, HalfDay>();
        for (const e of res.leave ?? []) {
          const prev = map.get(e.instructor.id);
          // Two requests on one date (a pending one on top of an approved one, or
          // both halves) — the stricter reading wins.
          map.set(e.instructor.id, prev === undefined || prev === e.half_day ? e.half_day : "none");
        }
        setOnLeave(map);
      } catch {
        if (!cancelled) setOnLeave(NO_LEAVE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, date]);

  return onLeave;
}

const LEAVE_LABEL: Record<HalfDay, string> = {
  none: " — On leave",
  morning: " — On leave (AM)",
  afternoon: " — On leave (PM)",
};

/**
 * One instructor in a `<select>`, labelled and greyed when they are away.
 *
 * Only a whole-day absence is `disabled`: a morning half-day still leaves the
 * afternoon teachable, so it is labelled and left pickable rather than blocking
 * a booking the server would happily accept.
 */
export function InstructorOption({
  instructor,
  onLeave,
}: {
  instructor: CatalogInstructor;
  onLeave: InstructorLeave;
}) {
  const half = onLeave.get(instructor.id);
  return (
    <option
      value={instructor.id}
      disabled={half === "none"}
      className={half ? "text-muted" : undefined}
    >
      {instructor.name}
      {half ? LEAVE_LABEL[half] : ""}
    </option>
  );
}
