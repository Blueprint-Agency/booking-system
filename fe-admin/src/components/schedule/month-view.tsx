import { format, isSameMonth } from "date-fns";
import type { Session, Instructor } from "@/types";
import { isSameCalendarDay, monthRange, sessionsOn } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({
  anchor,
  sessions,
  instructors,
  today,
}: {
  anchor: Date;
  sessions: Session[];
  instructors: Instructor[];
  today: Date;
}) {
  const { days } = monthRange(anchor);
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-2">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink/50"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const inMonth = isSameMonth(day, anchor);
          const daySessions = sessionsOn(sessions, day);
          const isToday = isSameCalendarDay(day, today);
          const visible = daySessions.slice(0, 3);
          const extra = daySessions.length - visible.length;
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-[120px] rounded-xl border p-2",
                inMonth ? "border-ink/10 bg-paper/40" : "border-ink/5 bg-paper/20 opacity-60",
              )}
            >
              <div className="mb-1 flex items-center justify-end">
                <span
                  className={
                    isToday
                      ? "rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white"
                      : "text-[12px] font-semibold text-ink"
                  }
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {visible.map((s) => {
                  const inst = instructors.find((i) => i.id === s.instructorId);
                  return (
                    <a
                      key={s.id}
                      href={`/schedule/${s.id}`}
                      className="truncate rounded-md bg-white px-1.5 py-1 text-[11px] text-ink hover:bg-accent/5"
                      title={`${s.name} · ${inst?.name ?? "—"}`}
                    >
                      <span className="font-mono text-ink/60">{s.time}</span>{" "}
                      {s.name}
                    </a>
                  );
                })}
                {extra > 0 && (
                  <span className="text-[10px] text-ink/50">+{extra} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
