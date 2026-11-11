"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MousePointerClick,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  Loader2,
} from "lucide-react";
import { Button, LoadFailure, PageHeader } from "@/components/ui";
import { useStudioZone } from "@/components/brand/brand-provider";
import { answeredElsewhere } from "@/lib/failed-read";
import { cn } from "@/lib/utils";
import { formatPlainDay } from "@/lib/formatters";
import { gridDays, gridWindow } from "@/lib/schedule-grid";
import { addDays, addMonths } from "@/lib/studio-time";
import { PtRequestPickerDialog } from "@/components/schedule/pt-request-picker-dialog";
import { CorporateRequestPickerDialog } from "@/components/schedule/corporate-request-picker-dialog";
import {
  Legend,
  ScheduleCalendar,
  ViewToggle,
  WeekStrip,
  type CalendarResolver,
} from "@/components/schedule/schedule-calendar";
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

const ADD_KINDS: { kind: AddKind; label: string }[] = [
  { kind: "class", label: "Class" },
  { kind: "workshop", label: "Workshop" },
  { kind: "corporate", label: "Corporate" },
  { kind: "pt", label: "PT Session" },
];

/** Kinds created on their own page; the rest open a picker over the grid. */
const NEW_PAGE: Partial<Record<AddKind, string>> = {
  // A weekly series starts here too, with Repeat weekly: the slot picked becomes
  // its first date (and so its weekday) and times.
  class: "/admin/schedule/new/class",
  workshop: "/admin/packages/workshops/new",
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

  const headingLabel =
    view === "day"
      ? formatPlainDay(cursor, "EEEE, d MMM yyyy")
      : view === "week"
        ? `${formatPlainDay(range.first, "d MMM")} – ${formatPlainDay(range.last, "d MMM yyyy")}`
        : formatPlainDay(cursor, "MMMM yyyy");

  const filtersActive = type !== "all" || instructorId !== "all";

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

  const navigate = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setCursor(todayKey);
    if (view === "day") return setCursor(addDays(cursor, dir));
    if (view === "week") return setCursor(addDays(cursor, 7 * dir));
    return setCursor(addMonths(cursor, dir));
  };

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Unified timetable of classes, workshops, and private sessions."
        actions={ADD_KINDS.map((k) => (
          <Button
            key={k.kind}
            variant={addMode === k.kind ? "primary" : "secondary"}
            size="sm"
            aria-pressed={addMode === k.kind}
            onClick={() => setAddMode(addMode === k.kind ? null : k.kind)}
          >
            <Plus className="h-4 w-4" /> {k.label}
          </Button>
        ))}
      />

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border p-3 sm:flex-nowrap sm:p-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 sm:h-8"
              onClick={() => navigate(0)}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* On a phone the date takes the row beside the arrows; the view and
              filter controls drop under both at full width. */}
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink sm:text-base">
            {headingLabel}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <ViewToggle value={view} onChange={setView} />
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(
                "ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:ml-0 sm:h-8",
                filtersActive
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "bg-card text-muted hover:text-ink"
              )}
              aria-expanded={filtersOpen}
            >
              <FilterIcon className="h-3.5 w-3.5" />
              Filters
              {filtersActive && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
                  {[type !== "all", instructorId !== "all"].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filters row */}
        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-paper/50 p-3 text-xs">
            <FilterPill
              label="Type"
              value={type}
              options={[
                { val: "all", label: "All" },
                { val: "class", label: "Class" },
                { val: "workshop", label: "Workshop" },
                { val: "pt", label: "Private" },
                { val: "corporate", label: "Corporate" },
              ]}
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
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setType("all");
                  setInstructorId("all");
                }}
                className="ml-auto min-h-9 px-1 text-xs font-medium text-muted hover:text-ink sm:min-h-8"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {addMode && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-accent/30 bg-accent/[0.07] px-3 py-2 text-xs font-medium text-accent">
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
            Pick a slot on the grid to place the new{" "}
            {ADD_KINDS.find((k) => k.kind === addMode)?.label.toLowerCase()}.
            <button
              type="button"
              onClick={() => setAddMode(null)}
              className="-my-1 ml-auto min-h-8 px-1 font-semibold underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        )}

        {view === "day" && <WeekStrip day={cursor} onPick={setCursor} />}

        {/* Calendar surface — day/week scroll internally so the toolbar and day
            headers stay put across the 6am–12am range. */}
        <div
          className={cn(
            "relative overflow-auto",
            view !== "month" && "max-h-[calc(100dvh-16rem)] min-h-[420px]"
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

      <Legend tip="Tip: hit a “+” button above, then click the slot it belongs in." />

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

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { val: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 focus-within:ring-2 focus-within:ring-accent sm:h-8">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 truncate bg-transparent text-xs font-medium text-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.val} value={o.val}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
