"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format as formatDateFns,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { localDay } from "@/lib/local-day";
import { useWorkspace } from "@/lib/workspace-context";
import { LEAVE_HALF_DAY_SHORT, LEAVE_TYPE_LABEL, formatLeaveDayRange, type LeaveType } from "@/lib/leave";
import { layoutWeek, personColours, type WeekLayout, type WeekSegment } from "@/lib/leave-calendar-layout";

/**
 * Who is away, for everybody on staff — admins and instructors alike — and the
 * same widget on the admin leave queue and on both "My leave" pages.
 *
 * The backend decides what this can show: `detail` arrives null for a
 * colleague's leave when an instructor is looking, so the type, the reason, the
 * decision and the Supporting Document are simply not in the response. This component
 * renders what it was given and hides nothing of its own.
 *
 * Each absence is one bar across its days, split only where a week wraps. Colour
 * says who; texture says how settled — approved is solid, pending is striped.
 */

interface ApiLeaveCalendarEntry {
  id: string;
  staff: { id: string; name: string };
  start_date: string;
  end_date: string;
  half_day: "none" | "morning" | "afternoon";
  status: "pending" | "approved";
  detail: {
    type: LeaveType;
    days: number;
    reason: string;
    decision_reason: string | null;
    decided_by: string | null;
    has_supporting_document: boolean;
    /** This absence breaches a declared leave conflict or the study leave cap —
     *  the backend measures it with the same function the refusal uses, and it
     *  arrives inside `detail`, so a colleague never sees it. */
    over_cap: boolean;
  } | null;
}

type View = "month" | "week";

/** The month view keeps each week to three stacked bars; the rest are a
 *  "+N more" that opens the week, where every lane is drawn. */
const MONTH_LANES = 3;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function tooltip(e: ApiLeaveCalendarEntry): string {
  const head =
    `${e.staff.name} — ${e.status === "pending" ? "pending" : "on leave"}` +
    (e.half_day === "morning" ? " (morning)" : e.half_day === "afternoon" ? " (afternoon)" : "");
  const bits = [formatLeaveDayRange(e.start_date, e.end_date)];
  if (e.detail) {
    bits.push(`${LEAVE_TYPE_LABEL[e.detail.type]} leave · ${e.detail.days} day(s)`, e.detail.reason);
    if (e.detail.over_cap)
      bits.push("⚠️ Breaches a leave conflict or the study leave cap — cover needs arranging");
    if (e.detail.decision_reason) bits.push(`Decision: ${e.detail.decision_reason}`);
    if (e.detail.decided_by) bits.push(`Decided by ${e.detail.decided_by}`);
  }
  return `${head}\n${bits.join("\n")}`;
}

/** The weeks a view draws, each Monday-first. A month takes only the rows it
 *  needs, so a five-week month doesn't end on an empty row of the next. */
function viewWeeks(view: View, cursor: Date): Date[][] {
  const start =
    view === "month"
      ? startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
      : startOfWeek(cursor, { weekStartsOn: 1 });
  const end =
    view === "month"
      ? endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
      : endOfWeek(cursor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

const tint = (colour: string, pct: number) => `color-mix(in srgb, ${colour} ${pct}%, transparent)`;

/** Approved: a solid tint with the person's colour ruled down its first day.
 *  Pending: the same colour, striped and dash-edged — drawn, since it still
 *  blocks scheduling, but visibly unsettled. A cut end has no edge. */
function barStyle(
  colour: string,
  pending: boolean,
  continuesBefore: boolean,
  continuesAfter: boolean,
): CSSProperties {
  if (pending) {
    return {
      backgroundImage: `repeating-linear-gradient(-45deg, ${tint(colour, 24)} 0 5px, ${tint(colour, 7)} 5px 10px)`,
      borderStyle: "dashed",
      borderColor: colour,
      borderWidth: `1px ${continuesAfter ? 0 : 1}px 1px ${continuesBefore ? 0 : 1}px`,
    };
  }
  return {
    backgroundColor: tint(colour, 17),
    boxShadow: continuesBefore ? undefined : `inset 3px 0 0 ${colour}`,
  };
}

export function LeaveCalendar() {
  const { api } = useWorkspace();
  const [view, setView] = useState<View>("month");
  // Any day inside the period shown; the view decides the period around it.
  const [cursor, setCursor] = useState(() => new Date());
  const [entries, setEntries] = useState<ApiLeaveCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Picked out on the roster: their bars stay lit and lead each week. */
  const [pinned, setPinned] = useState<string | null>(null);
  /** Hovered or focused on the roster: lit, without reshuffling the lanes. */
  const [previewed, setPreviewed] = useState<string | null>(null);

  const weeks = useMemo(() => viewWeeks(view, cursor), [view, cursor]);
  // The whole grid, not just the month — an absence on a trailing day of the
  // previous month still has to show in the row it is drawn in.
  const range = useMemo(
    () => ({ from: localDay(weeks[0][0]), to: localDay(weeks[weeks.length - 1][6]) }),
    [weeks],
  );

  // Stepping through periods quickly fires overlapping requests; only the one for
  // the period now on screen may write, or a slow earlier reply would draw last
  // period's absences under this period's dates.
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!api) return;
    const req = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ leave: ApiLeaveCalendarEntry[] }>(
        "/portal/leave-calendar",
        range,
      );
      if (req === latest.current) setEntries(res.leave ?? []);
    } catch {
      if (req !== latest.current) return;
      setError("Couldn't load the leave calendar.");
      setEntries([]);
    } finally {
      if (req === latest.current) setLoading(false);
    }
  }, [api, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.staff.id, e.staff]));
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);
  const colours = useMemo(() => personColours(people.map((p) => p.id)), [people]);

  // A pin on someone who isn't away in this period has nothing to light.
  const focus = people.some((p) => p.id === pinned) ? pinned : null;
  // Likewise a preview whose chip left the roster before its mouseleave fired
  // would otherwise dim every bar.
  const preview = people.some((p) => p.id === previewed) ? previewed : null;
  const lit = preview ?? focus;

  const layouts = useMemo(
    () =>
      weeks.map((days) =>
        layoutWeek(entries, localDay(days[0]), {
          maxLanes: view === "month" ? MONTH_LANES : undefined,
          first: focus,
        }),
      ),
    [weeks, entries, view, focus],
  );

  const navigate = (dir: -1 | 1) =>
    setCursor((c) => (view === "month" ? addMonths(startOfMonth(c), dir) : addWeeks(c, dir)));
  const openWeek = (day: Date) => {
    setCursor(day);
    setView("week");
  };

  const heading =
    view === "month"
      ? formatDateFns(cursor, "MMMM yyyy")
      : `${formatDateFns(weeks[0][0], "d MMM")} – ${formatDateFns(weeks[0][6], "d MMM yyyy")}`;
  const todayKey = localDay();
  const anyOverCap = entries.some((e) => e.detail?.over_cap);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold text-ink">Who is away</h2>
        {/* One group, so on a phone the stepper wraps as a whole to the right
            instead of stranding an arrow on its own line. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === "month" ? "Previous month" : "Previous week"}
              className="h-10 w-10 sm:h-8 sm:w-8"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums text-ink">
              {heading}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === "month" ? "Next month" : "Next week"}
              className="h-10 w-10 sm:h-8 sm:w-8"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="secondary" size="sm" className="h-9 sm:h-8" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        {/* The roster: who is away in this period, in the colour they are drawn
            in. Hover to light someone up; click to keep them lit and on top. */}
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          {people.length === 0 ? (
            !loading &&
            !error && (
              <p className="text-xs text-muted">
                Nobody is away this {view}.
              </p>
            )
          ) : (
            people.map((p) => {
              const colour = colours.get(p.id)!;
              const on = focus === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  title={on ? `Stop highlighting ${p.name}` : `Highlight ${p.name}`}
                  onClick={() => setPinned(on ? null : p.id)}
                  onMouseEnter={() => setPreviewed(p.id)}
                  onMouseLeave={() => setPreviewed(null)}
                  onFocus={() => setPreviewed(p.id)}
                  onBlur={() => setPreviewed(null)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-7",
                    on ? "border-transparent" : "border-border bg-card hover:bg-paper",
                  )}
                  style={on ? { backgroundColor: tint(colour, 18), borderColor: colour } : undefined}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
                  {p.name}
                </button>
              );
            })
          )}
        </div>

        {/* Seven columns can't shrink below legibility: on a phone the grid
            scrolls sideways at a fixed 640px rather than squeezing each day. */}
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b border-border bg-paper/40">
              {weeks[0].map((d, i) => {
                const isToday = localDay(d) === todayKey;
                return (
                  <div
                    key={WEEKDAYS[i]}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-xs"
                  >
                    {WEEKDAYS[i]}
                    {view === "week" && (
                      <span
                        className={cn(
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold normal-case tracking-normal",
                          isToday ? "bg-accent text-white" : "text-ink",
                        )}
                      >
                        {formatDateFns(d, "d")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {weeks.map((days, w) => (
              <WeekRow
                key={localDay(days[0])}
                view={view}
                days={days}
                layout={layouts[w]}
                monthStart={startOfMonth(cursor)}
                todayKey={todayKey}
                colours={colours}
                lit={lit}
                onOpenWeek={openWeek}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={barStyle("#5a6174", false, false, false)} />
          Approved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={barStyle("#5a6174", true, false, false)} />
          Pending a decision — still blocks scheduling
        </span>
        {anyOverCap && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden>⚠️</span> Breaches a leave conflict or the study leave cap
          </span>
        )}
        {view === "month" && <span className="sm:ml-auto">Select a date to see its whole week.</span>}
      </p>
    </section>
  );
}

function WeekRow({
  view,
  days,
  layout,
  monthStart,
  todayKey,
  colours,
  lit,
  onOpenWeek,
}: {
  view: View;
  days: Date[];
  layout: WeekLayout<ApiLeaveCalendarEntry>;
  monthStart: Date;
  todayKey: string;
  colours: Map<string, string>;
  lit: string | null;
  onOpenWeek: (day: Date) => void;
}) {
  const month = view === "month";
  // In the month view the first grid row holds the dates; bars start below.
  const laneRow = (lane: number) => lane + (month ? 2 : 1);

  return (
    <div className="relative border-b border-border last:border-b-0">
      {/* The day cells, behind the bars — a bar lies across the lines between
          its days rather than being broken by them. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-7">
        {days.map((d) => {
          const out = month && d.getMonth() !== monthStart.getMonth();
          const isToday = localDay(d) === todayKey;
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "border-r border-border last:border-r-0",
                out && "bg-paper/50",
                isToday && "bg-accent/[0.04]",
              )}
            />
          );
        })}
      </div>

      <div
        className={cn(
          "relative grid grid-cols-7 content-start gap-y-1 pb-2",
          month ? "min-h-[104px] sm:min-h-[124px]" : "min-h-[280px] pt-2",
        )}
      >
        {month &&
          days.map((d, i) => {
            const out = d.getMonth() !== monthStart.getMonth();
            const isToday = localDay(d) === todayKey;
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onOpenWeek(d)}
                aria-label={`See the week of ${formatDateFns(d, "d MMMM")}`}
                style={{ gridColumn: i + 1, gridRow: 1 }}
                className={cn(
                  "m-1.5 inline-flex h-6 w-6 items-center justify-center justify-self-start rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:m-2",
                  isToday ? "bg-accent text-white" : out ? "text-muted hover:bg-paper" : "text-ink hover:bg-paper",
                )}
              >
                {formatDateFns(d, "d")}
              </button>
            );
          })}

        {layout.segments.map((s) => (
          <Bar
            key={s.entry.id}
            segment={s}
            view={view}
            colour={colours.get(s.entry.staff.id) ?? "#5a6174"}
            dimmed={lit !== null && lit !== s.entry.staff.id}
            style={{ gridColumn: `${s.startCol + 1} / span ${s.span}`, gridRow: laneRow(s.lane) }}
          />
        ))}

        {month &&
          layout.hidden.map(
            (n, i) =>
              n > 0 && (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenWeek(days[i])}
                  style={{ gridColumn: i + 1, gridRow: laneRow(layout.laneCount) }}
                  className="mx-1 justify-self-start rounded px-1 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  +{n} more
                </button>
              ),
          )}
      </div>
    </div>
  );
}

function Bar({
  segment: s,
  view,
  colour,
  dimmed,
  style,
}: {
  segment: WeekSegment<ApiLeaveCalendarEntry>;
  view: View;
  colour: string;
  dimmed: boolean;
  style: CSSProperties;
}) {
  const e = s.entry;
  const pending = e.status === "pending";
  // The type is restricted; which half is not — a colleague may see "(AM)"
  // without seeing what kind of leave it is.
  const half = LEAVE_HALF_DAY_SHORT[e.half_day].trim();
  const detailLine = [
    e.detail && `${LEAVE_TYPE_LABEL[e.detail.type]} · ${e.detail.days} ${e.detail.days === 1 ? "day" : "days"}`,
    pending && "Pending",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      title={tooltip(e)}
      style={{ ...style, ...barStyle(colour, pending, s.continuesBefore, s.continuesAfter) }}
      className={cn(
        "flex min-w-0 rounded-md text-ink transition-opacity duration-150",
        s.continuesBefore ? "ml-0 rounded-l-none pl-2" : "ml-1 pl-2.5",
        s.continuesAfter ? "mr-0 rounded-r-none pr-2" : "mr-1 pr-2",
        view === "month" ? "h-[22px] items-center gap-1 text-[11px] font-medium" : "flex-col justify-center py-1.5",
        dimmed && "opacity-25",
      )}
    >
      <span className={cn("flex min-w-0 items-center gap-1", view === "week" && "text-xs font-semibold")}>
        {/* Only ever on a row whose detail this viewer may see. */}
        {e.detail?.over_cap && (
          <span aria-label="Breaches a leave conflict or the study leave cap">⚠️</span>
        )}
        {s.continuesBefore && <span aria-hidden className="text-muted">‹</span>}
        <span className="truncate">{e.staff.name}</span>
        {half && <span className="shrink-0 text-[10px] font-medium text-muted">{half}</span>}
      </span>
      {view === "week" && detailLine && (
        <span className="truncate text-[11px] text-muted">{detailLine}</span>
      )}
      <span className="sr-only">
        {`, ${pending ? "pending" : "approved"}, ${formatLeaveDayRange(e.start_date, e.end_date)}`}
      </span>
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { v: View; label: string }[] = [
    { v: "month", label: "Month" },
    { v: "week", label: "Week" },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-paper p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-8 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-7",
            value === o.v ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
