import Link from "next/link";
import type { Session, Instructor } from "@/types";
import { cn } from "@/lib/utils";

export function SessionChip({
  session,
  instructors,
}: {
  session: Session;
  instructors: Instructor[];
}) {
  const instructor = instructors.find((i) => i.id === session.instructorId);
  const capacityPct = session.capacity === 0 ? 0 : session.bookedCount / session.capacity;
  const isFull = capacityPct >= 1;
  const cancelled = session.status === "cancelled";
  return (
    <Link
      href={`/schedule/${session.id}`}
      className={cn(
        "group block rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-xs transition-colors hover:border-accent/40 hover:bg-accent/[0.03]",
        cancelled && "opacity-50 line-through",
        session.type === "workshop" && "border-l-4 border-l-cyan",
        session.type === "private" && "border-l-4 border-l-sage",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[11px] text-ink/70">{session.time}</span>
        <span
          className={cn(
            "font-mono text-[10px]",
            isFull ? "text-error" : "text-ink/60",
          )}
        >
          {session.bookedCount}/{session.capacity}
        </span>
      </div>
      <div className="truncate font-medium text-ink">{session.name}</div>
      <div className="truncate text-[11px] text-ink/60">
        {instructor?.name ?? "—"}
      </div>
    </Link>
  );
}
