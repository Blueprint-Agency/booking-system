import { format } from "date-fns";
import type { Session, Instructor } from "@/types";
import { isSameCalendarDay, sessionsOn, weekRange } from "@/lib/schedule";
import { SessionChip } from "./session-chip";

export function WeekView({
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
  const { days } = weekRange(anchor);
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const daySessions = sessionsOn(sessions, day);
        const isToday = isSameCalendarDay(day, today);
        return (
          <div
            key={day.toISOString()}
            className="min-h-[320px] rounded-xl border border-ink/10 bg-paper/40 p-2"
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                {format(day, "EEE")}
              </span>
              <span
                className={
                  isToday
                    ? "rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white"
                    : "text-sm font-semibold text-ink"
                }
              >
                {format(day, "d")}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {daySessions.length === 0 ? (
                <div className="mt-4 text-center text-[11px] text-ink/30">—</div>
              ) : (
                daySessions.map((s) => (
                  <SessionChip key={s.id} session={s} instructors={instructors} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
