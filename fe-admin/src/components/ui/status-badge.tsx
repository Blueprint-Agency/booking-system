import { Badge } from "./badge";

type StatusTone = "neutral" | "accent" | "sage" | "warning" | "error" | "cyan";

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  // sessions / bookings
  scheduled: { label: "Scheduled", tone: "accent" },
  confirmed: { label: "Confirmed", tone: "sage" },
  attended: { label: "Attended", tone: "sage" },
  completed: { label: "Completed", tone: "sage" },
  pending: { label: "Pending", tone: "warning" },
  waitlisted: { label: "Waitlisted", tone: "cyan" },
  late: { label: "Late", tone: "warning" },
  "no-show": { label: "No-show", tone: "error" },
  cancelled: { label: "Cancelled", tone: "error" },
  // invoices
  paid: { label: "Paid", tone: "sage" },
  failed: { label: "Failed", tone: "error" },
  refunded: { label: "Refunded", tone: "neutral" },
  // clients
  active: { label: "Active", tone: "sage" },
  inactive: { label: "Inactive", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  past_due: { label: "Past due", tone: "error" },
  // private requests
  accepted: { label: "Accepted", tone: "sage" },
  declined: { label: "Declined", tone: "error" },
  alt_proposed: { label: "Alt proposed", tone: "cyan" },
  // roles
  admin: { label: "Admin", tone: "accent" },
  instructor: { label: "Instructor", tone: "cyan" },
  super: { label: "Super", tone: "warning" },
  // tenants
  suspended: { label: "Suspended", tone: "error" },
  trial: { label: "Trial", tone: "cyan" },
  incomplete: { label: "Incomplete", tone: "warning" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const meta = STATUS_MAP[status] ?? { label: label ?? status, tone: "neutral" as StatusTone };
  return <Badge tone={meta.tone}>{label ?? meta.label}</Badge>;
}
