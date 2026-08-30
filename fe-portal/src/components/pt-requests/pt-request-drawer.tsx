"use client";
import { X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import {
  type ApiPtRequest,
  PT_STATUS_TONE,
  ptPartnerDisplay,
  ptRefundLabel,
  ptStatusLabel,
} from "@/lib/pt-requests";

export function PtRequestDrawer({
  request,
  onSchedule,
  onCancel,
  onClose,
}: {
  request: ApiPtRequest;
  onSchedule: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const partnerNeedsAccount =
    request.session_type === "2on1" && !request.co_client?.clientId;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-50 h-full w-full max-w-md overflow-y-auto bg-card p-4 shadow-xl sm:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-muted hover:bg-paper hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 flex items-center gap-3 pr-8">
          <Avatar name={request.client.name} size={40} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{request.client.name}</h2>
            <div className="text-xs text-muted">
              Submitted {formatRelative(request.created_at)}
            </div>
          </div>
        </div>
        <dl className="space-y-3 border-y border-border py-4 text-sm">
          <Row label="Format">
            {request.session_type === "1on1" ? "1-on-1" : "2-on-1"}
          </Row>
          <Row label="Class type">{request.class_type.name}</Row>
          <Row label="Location">{request.location.name}</Row>
          {request.session_type === "2on1" && (
            <Row label="Partner">
              <div className="flex items-center gap-2">
                <span>{ptPartnerDisplay(request)}</span>
                {partnerNeedsAccount && <Badge tone="accent">needs account</Badge>}
              </div>
            </Row>
          )}
          <Row label="Proposed slots">
            <ul className="space-y-0.5">
              {request.slots.map((s, i) => (
                <li key={i} className="text-ink">
                  {s.proposed_date} · {s.start_time}–{s.end_time}
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
            <Badge tone={PT_STATUS_TONE[request.status]}>
              {ptStatusLabel(request)}
            </Badge>
          </Row>
          {ptRefundLabel(request.refund_outcome) && (
            <Row label="Refund outcome">
              {ptRefundLabel(request.refund_outcome)}
            </Row>
          )}
          {request.session && (
            <Row label="Scheduled session">
              <div className="text-ink">
                {formatDateTime(request.session.starts_at)} –{" "}
                {formatDateTime(request.session.ends_at)}
              </div>
              <div className="text-xs text-muted">
                {[request.session.instructor_name, request.session.room_name]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
            </Row>
          )}
        </dl>
        {request.status === "pending" && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={onSchedule}>Schedule</Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel request
            </Button>
          </div>
        )}
        {request.status === "scheduled" && (
          <div className="mt-6 space-y-3">
            {request.resolved_at && (
              <div className="rounded-md bg-paper p-3 text-xs text-muted">
                Scheduled on {formatDateTime(request.resolved_at)}.
              </div>
            )}
            <Button variant="ghost" onClick={onCancel}>
              Cancel session
            </Button>
          </div>
        )}
        {(request.status === "cancelled_before_scheduled" ||
          request.status === "cancelled_after_scheduled" ||
          request.status === "attended") &&
          request.resolved_at && (
            <div className="mt-6 rounded-md bg-paper p-3 text-xs text-muted">
              {ptStatusLabel(request)} on {formatDateTime(request.resolved_at)}.
            </div>
          )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
