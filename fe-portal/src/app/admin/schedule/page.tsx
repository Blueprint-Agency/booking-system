"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LoadFailure, PageHeader } from "@/components/ui";
import { useStudioZone } from "@/components/brand/brand-provider";
import { answeredElsewhere } from "@/lib/failed-read";
import { cn } from "@/lib/utils";
import { gridDays, gridWindow } from "@/lib/schedule-grid";
import { PtRequestPickerDialog } from "@/components/schedule/pt-request-picker-dialog";
import { CorporateRequestPickerDialog } from "@/components/schedule/corporate-request-picker-dialog";
import {
  Legend,
  ScheduleCalendar,
  ViewToggle,
  WeekStrip,
  type CalendarResolver,
} from "@/components/schedule/schedule-calendar";
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
import { ScheduleListView } from "@/components/schedule/schedule-list-view";
import { useWorkspace } from "@/lib/workspace-context";
import { useSchedule } from "@/lib/use-schedule";
import { useSchedulePosition } from "@/lib/use-schedule-position";
import { slotHref, type Slot } from "@/lib/schedule";

type AddKind = "class" | "workshop" | "corporate" | "pt";
type FilterType = "all" | "class" | "workshop" | "pt" | "corporate";

interface ApiInstructor {
  id: string;
  name: string;
  status: "pending" | "active" | "archived";
  archived_at: string | null;
}

const ADD_KINDS: { kind: AddKind; label: string; noun: string }[] = [
  { kind: "class", label: "Class", noun: "class" },
  { kind: "workshop", label: "Workshop", noun: "workshop" },
  { kind: "corporate", label: "Corporate", noun: "corporate session" },
  { kind: "pt", label: "PT Session", noun: "PT session" },
];

/** Kinds created on their own page; the rest open a picker over the grid. */
const NEW_PAGE: Partial<Record<AddKind, string>> = {
  // A weekly series starts here too, with Repeat weekly: the slot picked becomes
  // its first date (and so its weekday) and times.
  class: "/admin/schedule/new/class",
  workshop: "/admin/schedule/new/workshop",
};

export default function SchedulePage() {
  const router = useRouter();
  const { api, activeLocationId, accessibleLocations } = useWorkspace();
  const timezone = useStudioZone();
  // The day the grid is on (a plain `YYYY-MM-DD` on the studio's calendar) and
  // its view, kept across a trip to a class's form or detail and back.
  const { cursor, view, today: todayKey, ready, setDate: setCursor, setView, open } =
    useSchedulePosition("admin-schedule-position");
  const [type, setType] = useState<FilterType>("all");
  const [instructorId, setInstructorId] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Picking a "+ …" button arms the grid: slots light up on hover and the next
  // click chooses when the thing goes. Nothing is placeable until then.
  const [addMode, setAddMode] = useState<AddKind | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  const list = view === "list";

  // A slot is picked on a grid, so arming a "+" from the List opens the week.
  const arm = (kind: AddKind | null) => {
    setAddMode(kind);
    if (kind && list) setView("week");
  };

  const [instructorsList, setInstructorsList] = useState<ApiInstructor[]>([]);
  // The instructor names could not be read: say so, never "Unknown".
  const [instructorsFailed, setInstructorsFailed] = useState(false);
  const [instructorsAttempt, setInstructorsAttempt] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const ins = await api.get<{ instructors: ApiInstructor[] }>(
          "/portal/admin/instructors",
        );
        if (cancelled) return;
        setInstructorsList(ins.instructors);
        setInstructorsFailed(false);
      } catch (err) {
        if (!cancelled && !answeredElsewhere(err)) setInstructorsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, instructorsAttempt]);

  const instructorById = useMemo(
    () => new Map(instructorsList.map((i) => [i.id, i.name])),
    [instructorsList],
  );
  const locationById = useMemo(
    () => new Map(accessibleLocations.map((l) => [l.id, l.name])),
    [accessibleLocations],
  );
  const resolver = useMemo<CalendarResolver>(
    () => ({
      instructorName: (id) => instructorById.get(id) ?? (instructorsFailed ? "—" : "Unknown"),
      locationName: (id) => (id ? (locationById.get(id) ?? "Unknown") : "—"),
      href: (e) => `/admin/schedule/${e.kind}/${e.kind === "workshop" ? e.raw.id : e.id}`,
    }),
    [instructorById, locationById, instructorsFailed],
  );

  const filterInstructors = useMemo(
    () =>
      instructorsList.filter(
        (i) => i.status === "active" && !i.archived_at,
      ),
    [instructorsList],
  );

  // The days the view draws, and the instants that bound them: the studio's
  // midnight of the first day up to the midnight after the last.
  const range = useMemo(
    () => ({ ...gridDays(view, cursor), ...gridWindow(timezone, view, cursor) }),
    [view, cursor, timezone],
  );

  const { entries: allEntries, loading, error, reload } = useSchedule(
    {
      from: range.from,
      to: range.to,
      locationId: activeLocationId ?? undefined,
    },
    { enabled: ready },
  );

  const entries = useMemo(
    () =>
      allEntries.filter((e) => {
        if (type !== "all" && e.kind !== type) return false;
        if (
          instructorId !== "all" &&
          !e.instructorIds.includes(instructorId)
        )
          return false;
        return true;
      }),
    [allEntries, type, instructorId]
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        const start = Date.parse(e.startsAt);
        return start >= Date.parse(range.from) && start < Date.parse(range.to);
      }),
    [entries, range]
  );

  const activeFilters = [type !== "all", instructorId !== "all"].filter(Boolean).length;

  const clearAdd = () => {
    setAddMode(null);
    setPickedSlot(null);
  };

  // Classes and workshops are created on their own page; PT and corporate
  // sessions are scheduled from an existing request, so the slot seeds their
  // picker dialog instead.
  const pickSlot = (slot: Slot) => {
    const page = addMode && NEW_PAGE[addMode];
    if (page) {
      clearAdd();
      router.push(slotHref(page, slot));
      return;
    }
    setPickedSlot(slot);
  };

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Unified timetable of classes, workshops, and private sessions."
        actions={<AddKindButtons kinds={ADD_KINDS} armed={addMode} onArm={arm} />}
      />

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-3 sm:flex-nowrap sm:p-4">
          <PrevTodayNext onStep={(dir) => setCursor(stepCursor(view, cursor, todayKey, dir))} />

          {/* On a phone the date takes the row beside the arrows; the view and
              filter controls drop under both at full width. */}
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
              onToggle={() => setFiltersOpen((v) => !v)}
            />
          </div>
        </div>

        {/* Filters row */}
        {filtersOpen && (
          <FiltersRow
            onClear={
              activeFilters > 0
                ? () => {
                    setType("all");
                    setInstructorId("all");
                  }
                : null
            }
          >
            <FilterPill
              label="Type"
              value={type}
              options={TYPE_FILTER_OPTIONS}
              onChange={(v) => setType(v as FilterType)}
            />
            <FilterPill
              label="Instructor"
              value={instructorId}
              options={[
                { val: "all", label: "All" },
                ...filterInstructors.map((i) => ({ val: i.id, label: i.name })),
              ]}
              onChange={setInstructorId}
            />
          </FiltersRow>
        )}

        {addMode && (
          <PickSlotBanner
            what={ADD_KINDS.find((k) => k.kind === addMode)?.noun ?? ""}
            onCancel={() => setAddMode(null)}
          />
        )}

        {view === "day" && <WeekStrip day={cursor} onPick={setCursor} />}

        {/* Calendar surface — day/week scroll internally so the toolbar and day
            headers stay put across the 6am–12am range; month and the List grow
            with the page. */}
        <div
          className={cn(
            "relative overflow-auto",
            (view === "day" || view === "week") && "max-h-[calc(100dvh-16rem)] min-h-[420px]"
          )}
        >
          {instructorsFailed && !error && (
            <LoadFailure
              what="the instructor names"
              variant="inline"
              detail="Classes show no instructor until they load."
              onRetry={() => setInstructorsAttempt((n) => n + 1)}
              className="m-2"
            />
          )}
          {/* A schedule that failed to load is never drawn as an empty week. */}
          {error ? (
            <LoadFailure what="the schedule" onRetry={reload} className="py-16" />
          ) : loading && allEntries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
            </div>
          ) : view === "list" ? (
            <ScheduleListView
              key={range.first}
              cursor={cursor}
              entries={visibleEntries}
              resolver={resolver}
              empty={activeFilters > 0 ? "Nothing matching the filters this week." : "Nothing scheduled this week."}
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

      <Legend tip={list ? undefined : ADD_TIP} />

      {addMode === "pt" && pickedSlot && (
        <PtRequestPickerDialog
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            clearAdd();
            void reload();
          }}
        />
      )}

      {addMode === "corporate" && pickedSlot && (
        <CorporateRequestPickerDialog
          slot={pickedSlot}
          onClose={clearAdd}
          onScheduled={() => {
            clearAdd();
            void reload();
          }}
        />
      )}
    </div>
  );
}
