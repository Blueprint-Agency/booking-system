"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { answeredElsewhere } from "@/lib/failed-read";
import { instructorOptionLabel, type HalfDay } from "@/lib/leave";
import type { CatalogInstructor } from "@/lib/catalog";

/**
 * "Who is away on this date" for the instructor pickers on the scheduling
 * screens — class create/edit, PT scheduling/edit, corporate scheduling/edit.
 *
 * This is a HINT, never the enforcement. The backend refuses an assignment that
 * lands on pending or approved leave (services/schedule/occupancy), and it does
 * so whatever this screen last managed to fetch, so the save is safe. But a
 * failed load is not "nobody is away": every option is then marked "leave not
 * checked" (`unchecked`), so the admin is not told a free day by silence. An
 * option is disabled only to save the admin a pointless round trip — nothing
 * here decides anything.
 *
 * Reads the all-staff `GET /portal/leave-calendar` with from == to == the chosen
 * date. Nothing leave-specific is added to the backend for the picker.
 */

/**
 * Who is away on the queried date, and whether that is known. `away` maps an
 * instructor id to the shape of their absence; absent = free, when `unchecked`
 * is false.
 */
export interface InstructorLeave {
  away: ReadonlyMap<string, HalfDay>;
  unchecked: boolean;
}

const NO_LEAVE: InstructorLeave = { away: new Map(), unchecked: false };
const LEAVE_UNCHECKED: InstructorLeave = { away: new Map(), unchecked: true };

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
          leave: { staff: { id: string }; half_day: HalfDay }[];
        }>("/portal/leave-calendar", { from: date, to: date });
        if (cancelled) return;
        const map = new Map<string, HalfDay>();
        for (const e of res.leave ?? []) {
          const prev = map.get(e.staff.id);
          // Two requests on one date (a pending one on top of an approved one, or
          // both halves) — the stricter reading wins.
          map.set(e.staff.id, prev === undefined || prev === e.half_day ? e.half_day : "none");
        }
        setOnLeave({ away: map, unchecked: false });
      } catch (err) {
        // A `401` ends the session and maintenance replaces the page; neither is this read's to flag.
        if (!cancelled) setOnLeave(answeredElsewhere(err) ? NO_LEAVE : LEAVE_UNCHECKED);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, date]);

  return onLeave;
}

/**
 * Which half of the day a `HH:MM` start falls in, or undefined when the screen
 * has no time to offer — the form may not have asked for one yet, or it may have
 * been cleared.
 *
 * This MIRRORS the backend's `HALF_DAY_BOUNDARY_HOUR`, where the rule, the
 * straddling case and their checks live (`be/src/services/leave/rules.ts`,
 * `leaveCoversStart`). The apps are hard-decoupled, so the portal cannot import
 * it and a second copy is unavoidable — this is the only place the split is
 * named on this side, and every screen asks through `InstructorOption` rather
 * than repeating it. Drift here costs a 409 from the server, never a wrong
 * booking: the picker only ever hints, and hints laxer than the rule.
 */
const AFTERNOON_FROM_HOUR = 13;

function halfOfDay(startTime?: string): HalfDay | undefined {
  const hour = Number(/^(\d{1,2}):/.exec(startTime ?? "")?.[1]);
  if (!Number.isInteger(hour)) return undefined;
  return hour < AFTERNOON_FROM_HOUR ? "morning" : "afternoon";
}

/**
 * One instructor in a `<select>`, labelled and greyed when they are away.
 *
 * A whole-day absence is always `disabled`. A half day is disabled only when the
 * screen knows the intended `startTime` AND that start falls in the half they
 * are away for — a morning absence still leaves the afternoon teachable. With no
 * start time the half is labelled and left pickable, and a class straddling the
 * boundary counts as the half it starts in: this is a hint, so it may be laxer
 * than the save, never stricter.
 */
export function InstructorOption({
  instructor,
  onLeave,
  startTime,
}: {
  instructor: CatalogInstructor;
  onLeave: InstructorLeave;
  /** The class's intended start, `HH:MM`. Omitted where the form has no time. */
  startTime?: string;
}) {
  const half = onLeave.away.get(instructor.id);
  return (
    <option
      value={instructor.id}
      disabled={half === "none" || (half !== undefined && half === halfOfDay(startTime))}
      className={half ? "text-muted" : undefined}
    >
      {instructorOptionLabel(instructor.name, half, onLeave.unchecked)}
    </option>
  );
}
