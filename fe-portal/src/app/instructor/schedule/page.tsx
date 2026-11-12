"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, LoadFailure, PageHeader } from "@/components/ui";
import { InstructorCancelClassDialog } from "@/components/schedule/instructor-cancel-class-dialog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { gridDays, gridWindow } from "@/lib/schedule-grid";
import { useStudioZone } from "@/components/brand/brand-provider";
import { PtRequestPickerDialog } from "@/components/schedule/pt-request-picker-dialog";
import {
  Legend,
  ScheduleCalendar,
  ViewToggle,
  WeekStrip,
  type CalendarResolver,
} from "@/components/schedule/schedule-calendar";
import { ScheduleListView } from "@/components/schedule/schedule-list-view";
import {
  ADD_TIP,
  AddKindButtons,
  FilterPill,
  FiltersButton,
  FiltersRow,
  PickSlotBanner,
  PrevTodayNext,
  SCHEDULE_VIEW_OPTIONS,
  TYPE_FILTER_OPTIONS,
  gridHeading,
  stepCursor,
} from "@/components/schedule/schedule-toolbar";
import { slotHref, type Slot } from "@/lib/schedule";
import { useSchedule, type ScheduleEntry } from "@/lib/use-schedule";
import { useSchedulePosition } from "@/lib/use-schedule-position";
import { myCalendarHref, myScheduleRow } from "@/lib/my-schedule";

type AddKind = "class" | "pt";
type FilterType = "all" | ScheduleEntry["kind"];

const ADD_KINDS: { kind: AddKind; label: string; noun: string }[] = [
  { kind: "class", label: "Class", noun: "class" },
  { kind: "pt", label: "PT Session", noun: "PT session" },
];

/**
 * An Instructor's own timetable: the classes they teach, the private sessions
 * they run, and the workshops and corporate sessions they are on. The Admin's
 * Schedule, drawn the same way — "+ Class" and "+ PT Session" arm the grid and
 * the slot picked seeds the form, and the List lays the month out by week —
 * with only what their Instructor Permissions allow.
 */
export default function InstructorSchedulePage() {
  const router = useRouter();
  const { may, accessibleLocations, currentStaff } = useWorkspace();
  const timezone = useStudioZone();
  // New class, Repeat weekly and Cancel are Schedule classes; the timetable is not.
  const canSchedule = may("schedule_classes");
  // A PT session put on their calendar (from a request or by hand) is Take PT bookings'.
  const canTakePt = may("take_pt_bookings");
  const addKinds = ADD_KINDS.filter((k) => (k.kind === "class" ? canSchedule : canTakePt));

  // Kept across a trip to a class's page and back, as the Admin's Schedule is.
  const { cursor, view, today, ready, setDate, setView, open } =
    useSchedulePosition("instructor-schedule-position");
  const list = view === "list";
  const [type, setType] = useState<FilterType>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddKind | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  // Cancel-own-class from the List: only ever offered for a class this instructor leads.
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);

  const range = useMemo(
    () => ({ ...gridDays(view, cursor), ...gridWindow(timezone, view, cursor) }),
    [view, cursor, timezone],
  );
  const { entries, loading, error, reload } = useSchedule(
    { from: range.from, to: range.to },
    { surface: "instructor", enabled: ready },
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        const start = Date.parse(e.startsAt);
        return start >= Date.parse(range.from) && start < Date.parse(range.to);
      }),
    [entries, range, type],
  );

  const locationById = useMemo(
    () => new Map(accessibleLocations.map((l) => [l.id, l.name])),
    [accessibleLocations],
  );
  const staffId = currentStaff?.id ?? null;
  const resolver = useMemo<CalendarResolver>(
    () => ({
      // It is their own calendar, so a block names no instructor and keeps the
      // row for the kind of session and the place.
      instructorName: () => "",
      locationName: (id) => (id ? (locationById.get(id) ?? "Studio") : ""),
      href: (e) => myCalendarHref(e, staffId),
    }),
    [locationById, staffId],
  );
  const viewer = { staffId, canScheduleClasses: canSchedule };

  const clearAdd = () => {
    setAddMode(null);
    setPickedSlot(null);
  };

  // A slot is picked on a grid, so arming a "+" from the List opens the week.
  const arm = (kind: AddKind | null) => {
    setAddMode(kind);
    if (kind && list) setView("week");
  };

  // A class is created on its own page; a PT session from a pending request or
  // by hand, in a picker over the grid.
  const pickSlot = (slot: Slot) => {
    if (addMode === "class") {
      clearAdd();
      router.push(slotHref("/instructor/schedule/new/class", slot));
      return;
    }
    setPickedSlot(slot);
  };

  return (
    <div>
      <PageHeader
        title="My schedule"
        description="Your classes, private sessions, workshops and corporate sessions."
        actions={
          addKinds.length > 0 ? (
            <AddKindButtons kinds={addKinds} armed={addMode} onArm={arm} />
          ) : undefined
        }
      />

      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-3 sm:flex-nowrap sm:p-4">
          <PrevTodayNext onStep={(dir) => setDate(stepCursor(view, cursor, today, dir))} />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">
            {gridHeading(view, cursor, range.first, range.last)}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ViewToggle
              value={view}
              options={SCHEDULE_VIEW_OPTIONS}
              onChange={(v) => {
                setView(v);
                if (v === "list") setAddMode(null);
              }}
            />
            <FiltersButton
              open={filtersOpen}
              active={type !== "all" ? 1 : 0}
              onToggle={() => setFiltersOpen((o) => !o)}
            />
          </div>
        </div>

        {filtersOpen && (
          <FiltersRow onClear={type !== "all" ? () => setType("all") : null}>
            <FilterPill
              label="Type"
              value={type}
              options={TYPE_FILTER_OPTIONS}
              onChange={(v) => setType(v as FilterType)}
            />
          </FiltersRow>
        )}

        {addMode && (
          <PickSlotBanner
            what={ADD_KINDS.find((k) => k.kind === addMode)?.noun ?? ""}
            onCancel={() => setAddMode(null)}
          />
        )}

        {view === "day" && <WeekStrip day={cursor} onPick={setDate} />}
        {/* Day and week scroll inside the card so the toolbar and day headers
            stay put across the 6am–12am range; month and the List grow with
            the page. */}
        <div
          className={cn(
            "relative overflow-auto",
            (view === "day" || view === "week") && "max-h-[calc(100dvh-16rem)] min-h-[420px]",
          )}
        >
          {/* A schedule that failed to load is never drawn as an empty week. */}
          {error ? (
            <LoadFailure what="your schedule" onRetry={reload} className="py-16" />
          ) : loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
            </div>
          ) : view === "list" ? (
            <ScheduleListView
              key={range.first}
              cursor={cursor}
              entries={visibleEntries}
              resolver={resolver}
              empty={type !== "all" ? "Nothing of this type this week." : "Nothing on your schedule this week."}
              rowAction={(e) =>
                myScheduleRow(e, viewer).canCancel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 text-error hover:bg-error/5 sm:h-8"
                    onClick={() => setCancelling(e)}
                  >
                    Cancel
                  </Button>
                ) : null
              }
            />
          ) : (
            <ScheduleCalendar
              view={view}
              cursor={cursor}
              weekStart={range.first}
              entries={visibleEntries}
              resolver={resolver}
              onPickSlot={addMode ? pickSlot : null}
              onOpenDay={(d) => open(d, "day")}
            />
          )}
        </div>
      </div>

      <Legend tip={addKinds.length > 0 && !list ? ADD_TIP : undefined} />

      {addMode === "pt" && pickedSlot && (
        <PtRequestPickerDialog
          role="instructor"
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            toast.success("Session scheduled");
            clearAdd();
            void reload();
          }}
        />
      )}

      <InstructorCancelClassDialog
        target={
          cancelling && cancelling.kind === "class"
            ? {
                id: cancelling.id,
                label: cancelling.label,
                startsAt: cancelling.startsAt,
                bookedCount: cancelling.bookedCount,
              }
            : null
        }
        onClose={() => setCancelling(null)}
        onCancelled={async () => {
          setCancelling(null);
          await reload();
        }}
      />
    </div>
  );
}
