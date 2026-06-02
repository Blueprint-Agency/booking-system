"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { corporateErrorMessage } from "@/lib/corporate-errors";
import { CorporateRequestDrawer } from "@/components/corporate-requests/corporate-request-drawer";
import { ScheduleFromCorporateRequestDialog } from "@/components/corporate-requests/schedule-from-corporate-request-dialog";
import { formatRelative, formatDateTime } from "@/lib/formatters";
import type { CorporateRequest, CorporateRequestStatus } from "@/types";

type Filter = CorporateRequestStatus | "all";

const FILTER_LABEL: Record<Filter, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  attended: "Attended",
  all: "All",
};

const STATUS_TONE: Record<CorporateRequestStatus, "accent" | "sage" | "error"> =
  {
    pending: "accent",
    scheduled: "sage",
    cancelled: "error",
    attended: "sage",
  };

const FILTERS: Filter[] = [
  "pending",
  "scheduled",
  "cancelled",
  "attended",
  "all",
];

// API JSON → camelCase domain shape (matches src/types CorporateRequest).
interface ApiCorporateRequest {
  id: string;
  status: CorporateRequestStatus;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  client: { id: string; name: string; email: string };
  package: { id: string; name: string };
  session: null | {
    id: string;
    starts_at: string;
    ends_at: string;
    location_name: string | null;
    instructor_name: string | null;
  };
}

function fromApi(r: ApiCorporateRequest): CorporateRequest {
  return {
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    client: r.client,
    package: r.package,
    session: r.session
      ? {
          id: r.session.id,
          startsAt: r.session.starts_at,
          endsAt: r.session.ends_at,
          locationName: r.session.location_name,
          instructorName: r.session.instructor_name,
        }
      : null,
  };
}

export default function CorporateRequestsPage() {
  const { api } = useWorkspace();
  const [tab, setTab] = useState<Filter>("pending");
  const [requests, setRequests] = useState<CorporateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedFor, setSchedFor] = useState<CorporateRequest | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ corporate_requests: ApiCorporateRequest[] }>(
        "/portal/admin/corporate-requests",
        { status: tab },
      );
      setRequests(res.corporate_requests.map(fromApi));
    } catch (err) {
      setError(corporateErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = requests.find((r) => r.id === activeId) ?? null;

  async function runAction(
    id: string,
    action: "cancel" | "attended",
  ) {
    if (!api) return;
    setActionBusy(true);
    try {
      await api.post(
        `/portal/admin/corporate-requests/${id}/${action}`,
      );
      setActiveId(null);
      await load();
    } catch (err) {
      setError(corporateErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Corporate Requests"
        description="Triage corporate session requests. Schedule them into the timetable, then mark attended (or cancel)."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        Corporate requests are shown across all locations — you pick the
        location when the session is scheduled.
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
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
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading requests…
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted">
          {tab === "pending"
            ? "No pending requests."
            : tab === "scheduled"
              ? "No scheduled corporate requests yet."
              : tab === "cancelled"
                ? "No cancelled requests."
                : tab === "attended"
                  ? "No attended sessions yet."
                  : "No requests."}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
          {requests.map((r) => (
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
                      {r.package.name}
                      {r.session
                        ? ` · ${formatDateTime(r.session.startsAt)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    <span className="text-xs text-muted">
                      {formatRelative(r.createdAt)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <CorporateRequestDrawer
          request={active}
          busy={actionBusy}
          onClose={() => setActiveId(null)}
          onSchedule={() => setSchedFor(active)}
          onCancel={() => void runAction(active.id, "cancel")}
          onAttended={() => void runAction(active.id, "attended")}
        />
      )}
      {schedFor && (
        <ScheduleFromCorporateRequestDialog
          request={schedFor}
          onClose={() => setSchedFor(null)}
          onScheduled={() => {
            setSchedFor(null);
            setActiveId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
