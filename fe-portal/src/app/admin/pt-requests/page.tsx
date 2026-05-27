"use client";
import { useState } from "react";
import { PageHeader, Badge } from "@/components/ui";
import { ptRequests as seedRequests, clients, classTypes } from "@/data";
import { PtRequestDrawer } from "@/components/pt-requests/pt-request-drawer";
import {
  ScheduleFromRequestDialog,
  type SchedulePayload,
} from "@/components/pt-requests/schedule-from-request-dialog";
import { formatRelative } from "@/lib/formatters";
import type { PtRequest } from "@/types";

type Filter = "pending" | "scheduled" | "cancelled" | "attended" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  attended: "Attended",
  all: "All",
};

const STATUS_TONE: Record<PtRequest["status"], "accent" | "sage" | "error"> = {
  pending: "accent",
  scheduled: "sage",
  cancelled_before_scheduled: "error",
  cancelled_after_scheduled: "error",
  attended: "sage",
};

const STATUS_SHORT: Record<PtRequest["status"], string> = {
  pending: "pending",
  scheduled: "scheduled",
  cancelled_before_scheduled: "cancelled",
  cancelled_after_scheduled: "cancelled",
  attended: "attended",
};

function inFilter(r: PtRequest, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "cancelled") {
    return (
      r.status === "cancelled_before_scheduled" ||
      r.status === "cancelled_after_scheduled"
    );
  }
  return r.status === f;
}

export default function PtRequestsPage() {
  const [requests, setRequests] = useState<PtRequest[]>(seedRequests);
  const [tab, setTab] = useState<Filter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<PtRequest | null>(null);

  const filtered = requests
    .filter((r) => inFilter(r, tab))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = requests.find((r) => r.id === activeId) ?? null;

  function applySchedule(req: PtRequest, payload: SchedulePayload) {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "scheduled" as const,
              scheduledPtSessionId: `pts-${Date.now().toString(36)}`,
              resolvedByStaffId: "stf-admin-1",
              resolvedAt: new Date().toISOString(),
            }
          : r,
      ),
    );
    setSchedFor(null);
    setActiveId(null);
    void payload;
  }

  function applyCancel(req: PtRequest) {
    // Branches on current status — matches services/pt-sessions/cancel.ts.
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status:
                r.status === "scheduled"
                  ? ("cancelled_after_scheduled" as const)
                  : ("cancelled_before_scheduled" as const),
              resolvedByStaffId: "stf-admin-1",
              resolvedAt: new Date().toISOString(),
            }
          : r,
      ),
    );
    setActiveId(null);
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const filters: Filter[] = ["pending", "scheduled", "cancelled", "attended", "all"];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="PT Requests"
        description="Triage client-submitted private session requests. Negotiate on WhatsApp, then schedule (or cancel)."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        PT requests are shown across all locations — clients pick their location when the session is scheduled.
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const count =
            f === "all"
              ? requests.length
              : requests.filter((r) => inFilter(r, f)).length;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setTab(f)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                tab === f
                  ? "border-accent bg-accent/10 text-ink"
                  : "border-border bg-card text-muted"
              }`}
            >
              {FILTER_LABEL[f]} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted">
          {tab === "pending"
            ? "No pending requests."
            : tab === "scheduled"
            ? "No scheduled PT requests yet."
            : tab === "cancelled"
            ? "No cancelled requests."
            : tab === "attended"
            ? "No attended sessions yet."
            : "No requests."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {filtered.map((r) => {
            const client = clients.find((c) => c.id === r.clientId);
            const classType = classTypes.find((ct) => ct.id === r.classTypeId);
            const first = r.slots[0];
            const more = r.slots.length - 1;
            const partnerHint =
              r.sessionType === "2on1" && !r.coClientId ? " · partner: needs account" : "";
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className="block w-full px-4 py-3 text-left transition hover:bg-paper"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{client?.name ?? "—"}</div>
                      <div className="text-xs text-muted">
                        {r.sessionType.toUpperCase()} · {classType?.name ?? "—"} ·{" "}
                        {first.proposedDate} {first.startTime}–{first.endTime}
                        {more > 0 ? ` +${more} more` : ""}
                        {partnerHint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={STATUS_TONE[r.status]}>
                        {STATUS_SHORT[r.status]}
                      </Badge>
                      <span className="text-xs text-muted">{formatRelative(r.createdAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <PtRequestDrawer
          request={active}
          onClose={() => setActiveId(null)}
          onSchedule={() => setSchedFor(active)}
          onCancel={() => applyCancel(active)}
        />
      )}
      {schedFor && (
        <ScheduleFromRequestDialog
          request={schedFor}
          onClose={() => setSchedFor(null)}
          onConfirm={(payload) => applySchedule(schedFor, payload)}
        />
      )}

      {pendingCount > 0 && tab !== "pending" && (
        <p className="text-xs text-muted">
          {pendingCount} pending request{pendingCount === 1 ? "" : "s"} waiting for triage.
        </p>
      )}
    </div>
  );
}
