"use client";
import { X } from "lucide-react";
import { clients, classTypes, locations } from "@/data";
import { Avatar, Badge, Button } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import type { PtRequest } from "@/types";

const STATUS_LABEL: Record<PtRequest["status"], string> = {
  pending: "pending",
  scheduled: "scheduled",
  cancelled_before_scheduled: "cancelled (refunded)",
  cancelled_after_scheduled: "cancelled (forfeited)",
  attended: "attended",
};

const STATUS_TONE: Record<PtRequest["status"], "accent" | "sage" | "error" | "neutral"> = {
  pending: "accent",
  scheduled: "sage",
  cancelled_before_scheduled: "error",
  cancelled_after_scheduled: "error",
  attended: "sage",
};

export function PtRequestDrawer({
  request,
  onSchedule,
  onCancel,
  onClose,
}: {
  request: PtRequest;
  onSchedule: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const client = clients.find((c) => c.id === request.clientId);
  const classType = classTypes.find((ct) => ct.id === request.classTypeId);
  const location = locations.find((l) => l.id === request.locationId);
  const partnerLabel = partnerDisplay(request);
  const partnerNeedsAccount =
    request.sessionType === "2on1" && !request.coClientId;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-50 h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-paper hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={client?.name ?? "Unknown"} size={40} />
          <div>
            <h2 className="text-base font-semibold text-ink">
              {client?.name ?? "Unknown client"}
            </h2>
            <div className="text-xs text-muted">
              Submitted {formatRelative(request.createdAt)}
            </div>
          </div>
        </div>
        <dl className="space-y-3 border-y border-border py-4 text-sm">
          <Row label="Format">
            {request.sessionType === "1on1" ? "1-on-1" : "2-on-1"}
          </Row>
          <Row label="Class type">{classType?.name ?? "—"}</Row>
          <Row label="Location">{location?.name ?? "—"}</Row>
          {request.sessionType === "2on1" && (
            <Row label="Partner">
              <div className="flex items-center gap-2">
                <span>{partnerLabel}</span>
                {partnerNeedsAccount && (
                  <Badge tone="accent">needs account</Badge>
                )}
              </div>
            </Row>
          )}
          <Row label="Proposed slots">
            <ul className="space-y-0.5">
              {request.slots.map((s, i) => (
                <li key={i} className="text-ink">
                  {s.proposedDate} · {s.startTime}–{s.endTime}
                </li>
              ))}
            </ul>
          </Row>
          {request.message && (
            <Row label="Message">
              <blockquote className="rounded-md border-l-2 border-border bg-paper p-2 italic">
                {request.message}
              </blockquote>
            </Row>
          )}
          <Row label="Status">
            <Badge tone={STATUS_TONE[request.status]}>
              {STATUS_LABEL[request.status]}
            </Badge>
          </Row>
        </dl>
        {request.status === "pending" && (
          <div className="mt-6 flex gap-2">
            <Button onClick={onSchedule}>Schedule</Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel request
            </Button>
          </div>
        )}
        {request.status === "scheduled" && (
          <div className="mt-6 space-y-3">
            <div className="rounded-md bg-paper p-3 text-xs text-muted">
              {request.resolvedAt && (
                <>Scheduled on {formatDateTime(request.resolvedAt)}.</>
              )}
            </div>
            <Button variant="ghost" onClick={onCancel}>
              Cancel session (no refund)
            </Button>
          </div>
        )}
        {(request.status === "cancelled_before_scheduled" ||
          request.status === "cancelled_after_scheduled" ||
          request.status === "attended") &&
          request.resolvedAt && (
            <div className="mt-6 rounded-md bg-paper p-3 text-xs text-muted">
              {STATUS_LABEL[request.status]} on{" "}
              {formatDateTime(request.resolvedAt)}.
            </div>
          )}
      </div>
    </div>
  );
}

function partnerDisplay(r: PtRequest): string {
  if (r.coClientId) {
    return (
      clients.find((c) => c.id === r.coClientId)?.name ?? "Existing member"
    );
  }
  if (r.coClientName || r.coClientEmail) {
    return [r.coClientName, r.coClientEmail].filter(Boolean).join(" · ");
  }
  return "—";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
