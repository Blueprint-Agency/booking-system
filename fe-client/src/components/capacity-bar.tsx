import { cn } from "@/lib/utils";

export function CapacityBar({
  booked,
  capacity,
  className,
}: {
  booked: number;
  capacity: number;
  className?: string;
}) {
  const pct = Math.min((booked / capacity) * 100, 100);
  const remaining = capacity - booked;
  const urgent = remaining > 0 && remaining <= 3;
  const full = remaining <= 0;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex-1 h-1.5 bg-warm rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            full ? "bg-muted" : urgent ? "bg-warning" : "bg-sage"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs font-medium whitespace-nowrap font-mono",
          full ? "text-muted" : urgent ? "text-warning" : "text-sage"
        )}
      >
        {full ? "Full" : `${remaining} left`}
      </span>
    </div>
  );
}
