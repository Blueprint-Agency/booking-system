"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { PtRequestDrawer } from "@/components/pt-requests/pt-request-drawer";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";
import { formatRelative } from "@/lib/formatters";
import {
  type ApiPtRequest,
  type PtFilter,
  PT_FILTER_LABEL,
  PT_STATUS_TONE,
  PT_STATUS_SHORT,
  ptInFilter,
} from "@/lib/pt-requests";

export default function PtRequestsPage() {
  const { api, activeLocation, loading: wsLoading } = useWorkspace();

  const [requests, setRequests] = useState<ApiPtRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PtFilter>("pending");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<ApiPtRequest | null>(null);

  // Fetch every status for the active workspace location; tabs filter client-side
  // so the per-tab counts stay accurate.
  const load = useCallback(async () => {
    if (!api || !activeLocation) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ pt_requests: ApiPtRequest[] }>(
        "/portal/admin/pt-sessions",
        { status: "all", location_id: activeLocation.id },
      );
      setRequests(res.pt_requests ?? []);
    } catch {
      setError("Couldn't load PT requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [api, activeLocation]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      requests
        .filter((r) => ptInFilter(r, tab))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [requests, tab],
  );
  const active = requests.find((r) => r.id === activeId) ?? null;
  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const filters: PtFilter[] = ["pending", "scheduled", "cancelled", "attended", "all"];

  async function handleCancel(req: ApiPtRequest) {
    if (!api) return;
    const scheduled = req.status === "scheduled";
    if (
      !confirm(
        scheduled
          ? "Cancel this scheduled session? The client is fully refunded (admin cancellation)."
          : "Cancel this pending request? The held credits are refunded.",
      )
    )
      return;
    try {
      await api.post(`/portal/admin/pt-sessions/${req.id}/cancel`);
      setActiveId(null);
      await load();
    } catch {
      setError("Couldn't cancel the request. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="PT Requests"
        description="Triage client-submitted private session requests. Negotiate on WhatsApp, then schedule (or cancel)."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        {activeLocation
          ? `Showing PT requests for ${activeLocation.name}. Switch the workspace location to see other studios.`
          : "Select a workspace location to see its PT requests."}
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const count = requests.filter((r) => ptInFilter(r, f)).length;
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
              {PT_FILTER_LABEL[f]} ({count})
            </button>
          );
        })}
      </div>

      {loading || wsLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
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
            const first = r.slots[0];
            const more = r.slots.length - 1;
            const partnerHint =
              r.session_type === "2on1" && !r.co_client?.clientId
                ? " · partner: needs account"
                : "";
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className="block w-full px-4 py-3 text-left transition hover:bg-paper"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{r.client.name}</div>
                      <div className="text-xs text-muted">
                        {r.session_type.toUpperCase()} · {r.class_type.name}
                        {first
                          ? ` · ${first.proposed_date} ${first.start_time}–${first.end_time}`
                          : ""}
                        {more > 0 ? ` +${more} more` : ""}
                        {partnerHint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={PT_STATUS_TONE[r.status]}>
                        {PT_STATUS_SHORT[r.status]}
                      </Badge>
                      <span className="text-xs text-muted">
                        {formatRelative(r.created_at)}
                      </span>
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
          onCancel={() => handleCancel(active)}
        />
      )}
      {schedFor && (
        <ScheduleFromRequestDialog
          request={schedFor}
          onClose={() => setSchedFor(null)}
          onScheduled={() => {
            setSchedFor(null);
            setActiveId(null);
            void load();
          }}
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
