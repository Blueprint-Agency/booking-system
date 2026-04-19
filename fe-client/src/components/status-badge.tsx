import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  // Session status
  scheduled: "bg-sage/10 text-sage",
  open: "bg-sage/10 text-sage",
  waitlist: "bg-warning/10 text-warning",
  full: "bg-warm text-muted",
  cancelled: "bg-error/10 text-error",
  completed: "bg-warm text-muted",

  // Booking status
  confirmed: "bg-sage/10 text-sage",
  waitlisted: "bg-warning/10 text-warning",

  // Check-in status
  pending: "bg-warm text-muted",
  attended: "bg-sage/10 text-sage",
  late: "bg-warning/10 text-warning",
  "no-show": "bg-error/10 text-error",

  // Activity
  active: "bg-sage/10 text-sage",
  inactive: "bg-warm text-muted",

  // Payment
  paid: "bg-sage/10 text-sage",

  // Level
  beginner: "bg-sage/10 text-sage",
  intermediate: "bg-accent/10 text-accent-deep",
  advanced: "bg-accent/15 text-accent-deep",
  all: "bg-warm text-muted",

  // Type
  regular: "bg-warm text-muted",
  workshop: "bg-accent/15 text-accent-deep",
  event: "bg-warm text-muted",

  // Category accents
  Wellness: "bg-accent/15 text-accent-deep",
  Fitness: "bg-warm text-muted",
  Recovery: "bg-sage/10 text-sage",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const variant = variants[status] || "bg-warm text-muted";
  const label = status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide",
        variant,
        className
      )}
    >
      {label}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: "bg-sage",
    open: "bg-sage",
    waitlist: "bg-warning",
    full: "bg-muted",
    cancelled: "bg-error",
  };
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        colors[status] || "bg-muted"
      )}
    />
  );
}
