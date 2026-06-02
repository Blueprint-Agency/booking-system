"use client";
import { X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/formatters";
import type { CorporateRequest, CorporateRequestStatus } from "@/types";

const STATUS_LABEL: Record<CorporateRequestStatus, string> = {
  pending: "pending",
  scheduled: "scheduled",
  cancelled: "cancelled",
  attended: "attended",
};

const STATUS_TONE: Record<
  CorporateRequestStatus,
  "accent" | "sage" | "error"
> = {
  pending: "accent",
  scheduled: "sage",
  cancelled: "error",
  attended: "sage",
};

export function CorporateRequestDrawer({
  request,
  onSchedule,
  onCancel,
  onAttended,
  onClose,
  busy,
}: {
  request: CorporateRequest;
  onSchedule: () => void;
  onCancel: () => void;
  onAttended: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const { client, package: pkg, session } = request;
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
          <Avatar name={client.name} size={40} />
          <div>
            <h2 className="text-base font-semibold text-ink">{client.name}</h2>
            <div className="text-xs text-muted">
              Submitted {formatRelative(request.createdAt)}
            </div>
          </div>
        </div>
        <dl className="space-y-3 border-y border-border py-4 text-sm">
          <Row label="Client email">{client.email}</Row>
          <Row label="Package">{pkg.name}</Row>
          {session && (
            <>
              <Row label="Scheduled for">
                {formatDateTime(session.startsAt)} – {formatDateTime(session.endsAt)}
              </Row>
              <Row label="Location">{session.locationName ?? "—"}</Row>
              <Row label="Instructor">{session.instructorName ?? "—"}</Row>
            </>
          )}
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
            <Button onClick={onSchedule} disabled={busy}>
              Schedule
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
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
            <div className="flex gap-2">
              <Button onClick={onAttended} disabled={busy}>
                Mark attended
              </Button>
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel session
              </Button>
            </div>
          </div>
        )}
        {(request.status === "cancelled" || request.status === "attended") &&
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

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
