"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRequestDeepLink } from "@/components/attention/deep-links";
import { useAttention } from "@/components/attention/attention-provider";
import { requestParam } from "@/lib/attention";
import { PageHeader, Badge, LoadFailure, Pagination, usePaged } from "@/components/ui";
import { answeredElsewhere } from "@/lib/failed-read";
import { useStudioZone } from "@/components/brand/brand-provider";
import { useWorkspace } from "@/lib/workspace-context";
import { scheduleErrorMessage } from "@/lib/schedule";
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
  preferred_location: string | null;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  client: { id: string; name: string; email: string; photo_url: string | null };
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
    preferredLocation: r.preferred_location,
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

// `useSearchParams` (the bell's `?request=` link) needs a Suspense boundary.
export default function CorporateRequestsPage() {
  return (
    <Suspense fallback={null}>
      <CorporateRequestsView />
    </Suspense>
  );
}

function CorporateRequestsView() {
  const { api } = useWorkspace();
  const timezone = useStudioZone();
  // The bell's count follows what this page resolves, without waiting for the next poll.
  const { refresh: refreshAttention } = useAttention();
  const search = useSearchParams();
  const wanted = requestParam(`?${search.toString()}`);
  const [tab, setTab] = useState<Filter>("pending");
  const [requests, setRequests] = useState<CorporateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A cancel or mark-attended the backend refused, with its reason.
  const [actionError, setActionError] = useState<string | null>(null);

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
      // The previous tab's rows are not this tab's: none are kept. A `401` or
      // maintenance is answered by the sign-in and the maintenance screen.
      setRequests([]);
      if (!answeredElsewhere(err)) setError(scheduleErrorMessage(err, "Failed", timezone));
    } finally {
      setLoading(false);
    }
  }, [api, tab, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  // A link from the bell (`?request=`) opens that request's drawer. The list
  // shows one status at a time, so first move to the tab for the status the
  // request has now; the drawer opens once that tab's list holds it.
  useEffect(() => {
    if (!api || !wanted) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ corporate_request: ApiCorporateRequest }>(
          `/portal/admin/corporate-requests/${wanted}`,
        );
        if (!cancelled) setTab(res.corporate_request.status);
      } catch {
        // Not found: the page opens as normal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, wanted]);
  useRequestDeepLink(requests, loading, (r) => setActiveId(r.id));

  const active = requests.find((r) => r.id === activeId) ?? null;
  const { visible, pagination } = usePaged(requests, tab);

  async function runAction(
    id: string,
    action: "cancel" | "attended",
  ) {
    if (!api) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.post(
        `/portal/admin/corporate-requests/${id}/${action}`,
      );
      setActiveId(null);
      await load();
      refreshAttention();
    } catch (err) {
      // A refused action keeps its reason; `error` is for a list that failed to load.
      setActionError(scheduleErrorMessage(err, "Failed", timezone));
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
            className={`h-9 rounded-full border px-3 text-xs transition sm:h-8 ${
              tab === f
                ? "border-accent bg-accent/10 text-ink"
                : "border-border bg-card text-muted"
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {actionError}
        </div>
      )}

      {error ? (
        <div className="rounded-xl border border-border bg-card">
          <LoadFailure what="the corporate requests" onRetry={load} />
        </div>
      ) : loading ? (
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
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className="block w-full px-4 py-3 text-left transition hover:bg-paper"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium text-ink">{r.client.name}</div>
                      <div className="break-words text-xs text-muted">
                        {r.package.name}
                        {r.session
                          ? ` · ${formatDateTime(timezone, r.session.startsAt)}`
                          : ""}
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
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
          <Pagination {...pagination} noun="requests" />
        </div>
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
            refreshAttention();
          }}
        />
      )}
    </div>
  );
}
