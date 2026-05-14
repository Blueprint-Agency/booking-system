"use client";
import { useState } from "react";
import { PageHeader, Badge } from "@/components/ui";
import { ptRequests as seedRequests, clients, instructors } from "@/data";
import { PtRequestDrawer } from "@/components/pt-requests/pt-request-drawer";
import {
  ScheduleFromRequestDialog,
  type SchedulePayload,
} from "@/components/pt-requests/schedule-from-request-dialog";
import { DeclineRequestDialog } from "@/components/pt-requests/decline-request-dialog";
import { formatRelative } from "@/lib/formatters";
import type { PtRequest } from "@/types";

type Filter = "pending" | "scheduled" | "declined" | "all";

export default function PtRequestsPage() {
  const [requests, setRequests] = useState<PtRequest[]>(seedRequests);
  const [tab, setTab] = useState<Filter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<PtRequest | null>(null);
  const [declineFor, setDeclineFor] = useState<PtRequest | null>(null);

  const filtered = requests
    .filter((r) => tab === "all" || r.status === tab)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = requests.find((r) => r.id === activeId) ?? null;

  function applySchedule(req: PtRequest, payload: SchedulePayload) {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "scheduled" as const,
              ptSessionId: `pts-${Date.now().toString(36)}`,
              decidedByStaffId: "stf-admin-1",
              decidedAt: new Date().toISOString(),
            }
          : r
      )
    );
    setSchedFor(null);
    setActiveId(null);
    void payload;
  }

  function applyDecline(req: PtRequest, note: string) {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: "declined" as const,
              declineNote: note,
              decidedByStaffId: "stf-admin-1",
              decidedAt: new Date().toISOString(),
            }
          : r
      )
    );
    setDeclineFor(null);
    setActiveId(null);
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="PT Requests"
        description="Triage client-submitted private session requests. Schedule, or decline with a reason."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        PT requests are shown across all locations — clients pick their location when the session is scheduled.
      </div>

      <div className="flex gap-2">
        {(["pending", "scheduled", "declined", "all"] as Filter[]).map((f) => {
          const count =
            f === "all" ? requests.length : requests.filter((r) => r.status === f).length;
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
              {f[0].toUpperCase() + f.slice(1)} ({count})
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
            : tab === "declined"
            ? "No declined requests."
            : "No requests."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {filtered.map((r) => {
            const client = clients.find((c) => c.id === r.clientId);
            const instructor = r.preferredInstructorId
              ? instructors.find((i) => i.id === r.preferredInstructorId)
              : null;
            const first = r.preferredSlots[0];
            const more = r.preferredSlots.length - 1;
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
                        {r.sessionType.toUpperCase()} · {r.durationMinutes} min ·{" "}
                        {instructor?.name ?? "Any instructor"} · {first.date}{" "}
                        {first.startTime}
                        {more > 0 ? ` +${more} more` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        tone={
                          r.status === "pending"
                            ? "accent"
                            : r.status === "scheduled"
                            ? "sage"
                            : "error"
                        }
                      >
                        {r.status}
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
          onDecline={() => setDeclineFor(active)}
        />
      )}
      {schedFor && (
        <ScheduleFromRequestDialog
          request={schedFor}
          onClose={() => setSchedFor(null)}
          onConfirm={(payload) => applySchedule(schedFor, payload)}
        />
      )}
      {declineFor && (
        <DeclineRequestDialog
          onClose={() => setDeclineFor(null)}
          onConfirm={(note) => applyDecline(declineFor, note)}
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
