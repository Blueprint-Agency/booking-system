import { cn } from "@/lib/utils";

/** Weekday, day and month of an instant, in studio time (as `formatDate`). */
function parts(iso: string) {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleDateString("en-SG", { ...opts, timeZone: "Asia/Singapore" });
  return {
    weekday: fmt({ weekday: "short" }),
    day: fmt({ day: "numeric" }),
    month: fmt({ month: "short" }),
  };
}

/**
 * The tear-off date on every booking a member holds: weekday, day, month,
 * stacked like the stub of a ticket. The one repeated device across the
 * account pages, so a booking reads the same wherever it appears.
 *
 * `iso` null is a booking with no date yet (a workshop still to be scheduled).
 */
export function DateStub({
  iso,
  tone = "default",
  className,
}: {
  iso: string | null;
  tone?: "default" | "accent" | "muted";
  className?: string;
}) {
  const p = iso ? parts(iso) : null;
  return (
    <div
      aria-hidden
      className={cn(
        "flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 leading-none",
        tone === "accent" && "bg-accent text-inverse",
        tone === "default" && "bg-accent/8 text-accent-deep",
        tone === "muted" && "bg-ink/5 text-muted",
        className,
      )}
    >
      {p ? (
        <>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{p.weekday}</span>
          <span className="mt-1 text-xl font-extrabold tabular-nums">{p.day}</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">{p.month}</span>
        </>
      ) : (
        <span className="text-[10px] font-bold uppercase tracking-wider">TBA</span>
      )}
    </div>
  );
}
