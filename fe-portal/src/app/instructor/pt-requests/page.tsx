"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRequestDeepLink } from "@/components/attention/deep-links";
import { useAttention } from "@/components/attention/attention-provider";
import { CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, LoadFailure, PageHeader, Pagination, usePaged } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { answeredElsewhere, loadError, type LoadError } from "@/lib/failed-read";
import { formatRelative } from "@/lib/formatters";
import { type PtProposedSlot, ptClassTypeName, ptSlotTime } from "@/lib/pt-requests";
import { ScheduleFromRequestDialog } from "@/components/pt-requests/schedule-from-request-dialog";

interface InstructorPtRequest {
  id: string;
  status: string;
  session_type: "1on1" | "2on1";
  message: string | null;
  created_at: string;
  expires_at: string | null;
  client: { id: string; name: string; email: string };
  class_type: { id: string; name: string } | null;
  location: { id: string; name: string };
  co_client: { clientId: string | null; name: string | null; email: string | null } | null;
  /**
   * The instructor the member's package is bound to. The queue only carries
   * requests this instructor may take, so a value here always means "bound to
   * you" — somebody else's bound request never arrives.
   */
  bound_instructor: { id: string; name: string } | null;
  slots: PtProposedSlot[];
}

// `useSearchParams` (the bell's `?request=` link) needs a Suspense boundary.
export default function InstructorPtRequestsPage() {
  return (
    <Suspense fallback={null}>
      <InstructorPtRequestsView />
    </Suspense>
  );
}

/**
 * The pending PT requests this instructor may take, drawn as the Admin's PT
 * Requests page is, for the workspace location. Scheduling one opens the same
 * dialog the Admin's does, and the session is theirs to run.
 */
function InstructorPtRequestsView() {
  const { api, activeLocation, loading: wsLoading } = useWorkspace();
  // The bell's count follows what this page resolves, without waiting for the next poll.
  const { refresh: refreshAttention } = useAttention();
  const [requests, setRequests] = useState<InstructorPtRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [schedId, setSchedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ pt_requests: InstructorPtRequest[] }>("/portal/instructor/pt-requests");
      setRequests(res.pt_requests ?? []);
    } catch (err) {
      // A `401` or maintenance is answered by the sign-in and the maintenance screen.
      if (!answeredElsewhere(err)) setError(loadError(err));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // The queue takes no filters, so the workspace location narrows it here.
  const locationId = activeLocation?.id ?? null;
  const here = useMemo(
    () =>
      requests
        .filter((r) => r.location.id === locationId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [requests, locationId],
  );
  const { visible, pagination } = usePaged(here, locationId ?? "");
  const scheduling = requests.find((r) => r.id === schedId) ?? null;

  // A link from the bell (`?request=`) opens that request's scheduling dialog.
  useRequestDeepLink(requests, loading, (r) => setSchedId(r.id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="PT Requests"
        description="The shared queue of pending private-session requests. Pick one up by scheduling it — it's assigned to you automatically."
      />

      <div className="rounded-lg border border-border bg-paper/60 px-3 py-2 text-xs text-muted">
        {activeLocation
          ? `Showing PT requests for ${activeLocation.name}. Switch the workspace location to see other studios.`
          : "Select a workspace location to see its PT requests."}
      </div>

      {/* A queue that failed to load is never drawn as "No pending requests". */}
      {error ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <LoadFailure what="the PT requests" detail={error.detail} onRetry={load} />
        </div>
      ) : loading || wsLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : here.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <EmptyState
            title="No pending requests"
            description="When a member requests a private session, it shows up here for any instructor to pick up."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} id={`pt-request-${r.id}`} className="px-4 py-3">
                {/* Stacked on a phone: the details get the full width and the
                    age + Schedule sit in a row beneath. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-medium text-ink">{r.client.name}</span>
                      {r.bound_instructor && <Badge tone="accent">Your member</Badge>}
                    </div>
                    <div className="break-words text-xs text-muted">
                      {r.session_type === "2on1" ? "2-on-1" : "1-on-1"} · {ptClassTypeName(r.class_type)}
                      {r.co_client
                        ? ` · partner: ${r.co_client.name ?? r.co_client.email ?? "needs account"}`
                        : ""}
                    </div>
                    {r.message && <p className="mt-1 break-words text-xs text-ink/80">“{r.message}”</p>}
                    {r.slots.length > 0 && (
                      <div className="mt-1 break-words text-xs text-muted">
                        Prefers: {r.slots.map((s) => `${s.proposed_date} ${ptSlotTime(s)}`).join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                    <span className="text-xs text-muted">{formatRelative(r.created_at)}</span>
                    <Button size="sm" className="h-10 sm:h-8" onClick={() => setSchedId(r.id)}>
                      <CalendarCheck className="h-3.5 w-3.5" /> Schedule
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination {...pagination} noun="requests" />
        </div>
      )}

      {scheduling && (
        <ScheduleFromRequestDialog
          role="instructor"
          request={scheduling}
          onClose={() => setSchedId(null)}
          onScheduled={() => {
            setSchedId(null);
            toast.success("Session scheduled — assigned to you");
            void load();
            refreshAttention();
          }}
        />
      )}
    </div>
  );
}
