import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A rule the member agrees to by booking, framed in the warning colour so it
 * is read before the first Book tap rather than found after a lost credit.
 * One short fact per line (`classPolicyPoints`).
 */
export function PolicyNotice({
  title,
  points,
  className,
}: {
  title: string;
  points: string[];
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("rounded-2xl border-2 border-warning bg-warning/10 px-4 py-3.5 sm:px-5", className)}
    >
      <p className="flex items-center gap-2 text-sm font-bold text-ink">
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {title}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-ink/85">
        {points.map((p) => (
          <li key={p} className="flex gap-2 leading-snug">
            <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
