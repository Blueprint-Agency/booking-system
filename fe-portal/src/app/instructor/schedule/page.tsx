"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, LoadFailure, PageHeader, Select } from "@/components/ui";
import { answeredElsewhere } from "@/lib/failed-read";
import { fetchInstructorNames, type InstructorName } from "@/lib/catalog";
import {
  SCOPE_OPTIONS,
  matchesStudioFilters,
  parseScope,
  type ScheduleScope,
} from "@/lib/instructor-schedule-scope";
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

/** Where the tab keeps whether the page is on My schedule or the Full studio schedule. */
const SCOPE_KEY = "instructor-schedule-scope";

const noSubscription = () => () => {};

function readStoredScope(): string {
  try {
    return window.sessionStorage.getItem(SCOPE_KEY) ?? "";
  } catch {
    // Storage blocked: open on My schedule.
    return "";
  }
}

const ADD_KINDS: { kind: AddKind; label: string; noun: string }[] = [
  { kind: "class", label: "Class", noun: "class" },
  { kind: "pt", label: "PT Session", noun: "PT session" },
];

/**
 * An Instructor's timetable: their own (the classes they teach, the private
 * sessions they run, and the workshops and corporate sessions they are on), or,
 * switched to the Full studio schedule, the studio's whole one — every
 * instructor's, with booked counts — to pick a slot knowing what else is on.
 * The Admin's Schedule, drawn the same way — "+ Class" and "+ PT Session" arm
 * the grid and the slot picked seeds the form, and the List lays the month out
 * by week — with only what their Instructor Permissions allow. Only their own
 * class or private session opens a page.
 */
export default function InstructorSchedulePage() {
  const router = useRouter();
  const { api, may, accessibleLocations, currentStaff } = useWorkspace();
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
  // My schedule or the Full studio schedule, kept for the tab like the position.
  // The stored choice is only known in the browser: null while the server draws
  // the page and through hydration, then what the tab kept ("" for nothing).
  const storedScope = useSyncExternalStore(noSubscription, readStoredScope, () => null);
  const scopeReady = storedScope !== null;
  const [chosenScope, setChosenScope] = useState<ScheduleScope | null>(null);
  const scope = chosenScope ?? parseScope(storedScope);
  const chooseScope = (next: ScheduleScope) => {
    setChosenScope(next);
    try {
      window.sessionStorage.setItem(SCOPE_KEY, next);
    } catch {
      // Not kept for the tab.
    }
  };
  const studio = scope === "studio";
  const [type, setType] = useState<FilterType>("all");
  const [instructorId, setInstructorId] = useState("all");
  const [locationId, setLocationId] = useState("all");
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
    { surface: studio ? "instructorStudio" : "instructor", enabled: ready && scopeReady },
  );

  // The names the Full studio schedule puts on other instructors' entries.
  const [instructors, setInstructors] = useState<InstructorName[]>([]);
  const [instructorsFailed, setInstructorsFailed] = useState(false);
  const [instructorsAttempt, setInstructorsAttempt] = useState(0);
  useEffect(() => {
    if (!api || !studio) return;
    let cancelled = false;
    void (async () => {
      try {
        // Cached for a minute, so switching back and forth asks once.
        const rows = await fetchInstructorNames(api);
        if (cancelled) return;
        setInstructors(rows);
        setInstructorsFailed(false);
      } catch (err) {
        if (!cancelled && !answeredElsewhere(err)) setInstructorsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, studio, instructorsAttempt]);
  const instructorById = useMemo(() => new Map(instructors.map((i) => [i.id, i.name])), [instructors]);
  const filterInstructors = useMemo(
    // A pending invitee can be scheduled, so can be filtered to.
    () => instructors.filter((i) => !i.archived_at),
    [instructors],
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        if (studio && !matchesStudioFilters(e, { instructorId, locationId })) return false;
        const start = Date.parse(e.startsAt);
        return start >= Date.parse(range.from) && start < Date.parse(range.to);
      }),
    [entries, range, type, studio, instructorId, locationId],
  );

  const locationById = useMemo(
    () => new Map(accessibleLocations.map((l) => [l.id, l.name])),
    [accessibleLocations],
  );
  const staffId = currentStaff?.id ?? null;
  const resolver = useMemo<CalendarResolver>(
    () => ({
      // On their own calendar a block names no instructor and keeps the row for
      // the kind of session and the place; the studio's names whose it is.
      instructorName: studio
        ? (id) =>
            instructorById.get(id) ?? (instructorsFailed ? "—" : instructors.length > 0 ? "Unknown" : "")
        : () => "",
      locationName: (id) => (id ? (locationById.get(id) ?? "Studio") : ""),
      // Only their own class or private session opens; another's shows but opens nothing.
      href: (e) => myCalendarHref(e, staffId),
    }),
    [studio, instructorById, instructors.length, instructorsFailed, locationById, staffId],
  );
  const activeFilters = [type !== "all", studio && instructorId !== "all", studio && locationId !== "all"].filter(
    Boolean,
  ).length;
  const clearFilters = () => {
    setType("all");
    setInstructorId("all");
    setLocationId("all");
  };
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
        title={studio ? "Studio schedule" : "My schedule"}
        description={
          studio
            ? "Everything on at the studio: every instructor's classes with their bookings, private sessions, workshops and corporate sessions."
            : "Your classes, private sessions, workshops and corporate sessions."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Whose schedule"
              value={scope}
              onChange={(e) => chooseScope(parseScope(e.target.value))}
              className="h-9 w-auto font-medium"
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.val} value={o.val}>
                  {o.label}
                </option>
              ))}
            </Select>
            {addKinds.length > 0 && <AddKindButtons kinds={addKinds} armed={addMode} onArm={arm} />}
          </div>
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
              active={activeFilters}
              onToggle={() => setFiltersOpen((o) => !o)}
            />
          </div>
        </div>

        {filtersOpen && (
          <FiltersRow onClear={activeFilters > 0 ? clearFilters : null}>
            <FilterPill
              label="Type"
              value={type}
              options={TYPE_FILTER_OPTIONS}
              onChange={(v) => setType(v as FilterType)}
            />
            {studio && (
              <FilterPill
                label="Instructor"
                value={instructorId}
                options={[
                  { val: "all", label: "All" },
                  ...filterInstructors.map((i) => ({ val: i.id, label: i.name })),
                ]}
                onChange={setInstructorId}
              />
            )}
            {/* Still shown while a location is picked, so a filter in force can be undone. */}
            {studio && (accessibleLocations.length > 1 || locationId !== "all") && (
              <FilterPill
                label="Location"
                value={locationId}
                options={[
                  { val: "all", label: "All" },
                  ...accessibleLocations.map((l) => ({ val: l.id, label: l.name })),
                ]}
                onChange={setLocationId}
              />
            )}
          </FiltersRow>
        )}

        {studio && instructorsFailed && !error && (
          <LoadFailure
            what="the instructor names"
            detail="Entries show no instructor until they load."
            onRetry={() => setInstructorsAttempt((n) => n + 1)}
          />
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
            <LoadFailure what={studio ? "the studio schedule" : "your schedule"} onRetry={reload} className="py-16" />
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
              empty={
                activeFilters > 0
                  ? "Nothing matching the filters this week."
                  : studio
                    ? "Nothing on at the studio this week."
                    : "Nothing on your schedule this week."
              }
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
