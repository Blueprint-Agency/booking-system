import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  // Session status
  scheduled: "bg-sage-light text-sage",
  open: "bg-sage-light text-sage",
  waitlist: "bg-warning-bg text-warning",
  full: "bg-warm text-muted",
  cancelled: "bg-error-bg text-error",
  completed: "bg-warm text-muted",

  // Booking status
  confirmed: "bg-sage-light text-sage",
  waitlisted: "bg-warning-bg text-warning",

  // Check-in status
  pending: "bg-warm text-muted",
  attended: "bg-sage-light text-sage",
  late: "bg-warning-bg text-warning",
  "no-show": "bg-error-bg text-error",

  // Activity
  active: "bg-sage-light text-sage",
  inactive: "bg-warm text-muted",

  // Payment
  paid: "bg-sage-light text-sage",

  // Level
  beginner: "bg-sage-light text-sage",
  intermediate: "bg-info-bg text-info",
  advanced: "bg-accent-glow text-accent-deep",
  all: "bg-warm text-muted",

  // Type
  regular: "bg-warm text-muted",
  workshop: "bg-accent-glow text-accent-deep",
  event: "bg-info-bg text-info",

  // Category accents
  Wellness: "bg-accent-glow text-accent-deep",
  Fitness: "bg-info-bg text-info",
  Recovery: "bg-sage-light text-sage",
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
