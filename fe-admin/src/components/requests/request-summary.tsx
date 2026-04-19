import Link from "next/link";
import type { Client, Instructor, PrivateRequest } from "@/types";
import { SlaChip } from "@/components/ui/sla-chip";

export function RequestSummary({
  request,
  clients,
  instructors,
}: {
  request: PrivateRequest;
  clients: Client[];
  instructors: Instructor[];
  now?: Date;
}) {
  const client = clients.find((c) => c.id === request.clientId);
  const inst = instructors.find((i) => i.id === (request.preferredInstructorId ?? ""));
  return (
    <Link
      href={`/requests/${request.id}`}
      className="flex items-center justify-between rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm transition-colors hover:border-accent/30"
    >
      <div>
        <div className="font-medium text-ink">
          {client ? `${client.firstName} ${client.lastName}` : "Unknown client"}
        </div>
        <div className="text-xs text-ink/50">
          Preferred: {inst?.name ?? "Any"} · {request.proposedSlots.length} slot(s) proposed
        </div>
      </div>
      <div className="flex items-center gap-3">
        {request.status === "pending" && <SlaChip deadlineAt={request.deadlineAt} />}
        {request.status !== "pending" && (
          <span
            className={
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
              (request.status === "approved"
                ? "bg-sage/10 text-sage"
                : "bg-error/10 text-error")
            }
          >
            {request.status}
          </span>
        )}
      </div>
    </Link>
  );
}
