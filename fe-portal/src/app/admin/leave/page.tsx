"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  EmptyState,
  Label,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { LeaveCalendar } from "@/components/leave-calendar";
import { useWorkspace } from "@/lib/workspace-context";
import { openSignedUrl } from "@/lib/api";
import { todayIso } from "@/lib/formatters";
import {
  formatLeaveDayRange,
  leaveErrorMessage,
  LEAVE_HALF_DAY_SUFFIX,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  LEAVE_TYPE_LABEL,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/leave";

/**
 * The leave queue — every instructor's requests, and the decision on each.
 *
 * Admin and superadmin both land here; the backend gates the mount, so there is
 * no role branch in this file. Whether a request can be approved, rejected or
 * revoked is the server's call — the buttons below mirror those rules so the
 * common mistake is hard to make, and the server refuses regardless.
 */

interface ApiAdminLeaveRequest {
  id: string;
  instructor: { id: string; name: string; email: string };
  type: LeaveType;
  start_date: string;
  end_date: string;
  half_day: "none" | "morning" | "afternoon";
  days: number;
  leave_year: number;
  status: LeaveStatus;
  reason: string;
  decision_reason: string | null;
  created_at: string;
  /** Whether there is a medical certificate to ask the server for. */
  has_certificate: boolean;
}

type Filter = LeaveStatus | "all";

const FILTERS: Filter[] = ["pending", "approved", "rejected", "all"];

const FILTER_LABEL: Record<Filter, string> = { ...LEAVE_STATUS_LABEL, all: "All" };

export default function AdminLeavePage() {
  const { api } = useWorkspace();
  const [requests, setRequests] = useState<ApiAdminLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Filter>("pending");
  /** List is the default: this page exists to clear the pending queue, and the
   *  calendar answers a different question — who is away, and when. */
  const [view, setView] = useState<"list" | "calendar">("list");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApiAdminLeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Fetch every status once; the tabs filter client-side so the counts stay honest.
  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ leave_requests: ApiAdminLeaveRequest[] }>(
        "/portal/admin/leave",
        { status: "all" },
      );
      setRequests(res.leave_requests ?? []);
    } catch (err) {
      setError(leaveErrorMessage(err, "Couldn't load leave requests"));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => requests.filter((r) => tab === "all" || r.status === tab),
    [requests, tab],
  );

  async function decide(r: ApiAdminLeaveRequest, action: "approve" | "revoke") {
    if (!api) return;
    if (
      action === "revoke" &&
      !confirm(
        `Revoke ${r.instructor.name}'s approved leave on ${formatLeaveDayRange(r.start_date, r.end_date)}? The days go back into their balance.`,
      )
    )
      return;
    setBusyId(r.id);
    try {
      await api.post(`/portal/admin/leave/${r.id}/${action}`);
      toast.success(action === "approve" ? "Leave approved." : "Leave revoked.");
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't update that request"));
    } finally {
      setBusyId(null);
    }
  }

  async function submitRejection() {
    if (!api || !rejecting) return;
    setBusyId(rejecting.id);
    try {
      await api.post(`/portal/admin/leave/${rejecting.id}/reject`, {
        reason: rejectReason.trim(),
      });
      toast.success("Request rejected. The instructor has been emailed the reason.");
      setRejecting(null);
      setRejectReason("");
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't reject that request"));
    } finally {
      setBusyId(null);
    }
  }

  /** The certificate is never in this payload — the server mints a short-lived
   *  signed URL per click, and the object is unreachable without one. */
  async function openCertificate(id: string) {
    if (!api) return;
    try {
      await openSignedUrl(api, `/portal/admin/leave/${id}/certificate`);
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't open that certificate"));
    }
  }

  // Mirrors the server rule: approved leave is only revocable before it starts.
  const notStarted = (r: ApiAdminLeaveRequest) => r.start_date > todayIso();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Leave"
        description="Instructor leave requests. Approving makes the absence binding — an instructor on approved leave can no longer be scheduled."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {/* Status filters belong to the list; the calendar shows every request
            it is allowed to show, so they are hidden rather than left inert. */}
        <div className="flex flex-wrap gap-2">
          {view === "list" &&
            FILTERS.map((f) => {
              const count = requests.filter((r) => f === "all" || r.status === f).length;
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

        <div className="inline-flex items-center rounded-md border border-border bg-paper p-0.5">
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-7 rounded px-3 text-xs font-medium capitalize transition-colors ${
                view === v ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "calendar" ? (
        <LeaveCalendar />
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={tab === "pending" ? "Nothing waiting for a decision" : "No requests here"}
          description={
            tab === "pending"
              ? "New leave requests appear here, and every admin is emailed when one arrives."
              : "Switch tabs to see requests in another state."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-3 py-2.5 font-medium">Instructor</th>
                <th className="px-3 py-2.5 font-medium">Dates</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Days</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="align-top hover:bg-warm/40">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{r.instructor.name}</div>
                    <div className="text-xs text-muted">{r.instructor.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-ink">
                      {formatLeaveDayRange(r.start_date, r.end_date)}
                      {LEAVE_HALF_DAY_SUFFIX[r.half_day]}
                    </span>
                    <p className="mt-0.5 max-w-xs text-xs text-muted">{r.reason}</p>
                    {r.decision_reason && (
                      <p className="mt-0.5 max-w-xs text-xs text-muted">
                        Decision: {r.decision_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {LEAVE_TYPE_LABEL[r.type]}
                    {r.has_certificate && (
                      <button
                        type="button"
                        className="mt-0.5 flex items-center gap-1 text-xs text-accent hover:underline"
                        onClick={() => void openCertificate(r.id)}
                      >
                        <Paperclip className="h-3 w-3" /> Certificate
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{r.days}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={LEAVE_STATUS_TONE[r.status]}>
                      {LEAVE_STATUS_LABEL[r.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {busyId === r.id ? (
                      <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted" />
                    ) : r.status === "pending" ? (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => decide(r, "approve")}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejectReason("");
                            setRejecting(r);
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : r.status === "approved" && notStarted(r) ? (
                      <Button size="sm" variant="ghost" onClick={() => decide(r, "revoke")}>
                        Revoke
                      </Button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Reject leave request"
        description={
          rejecting
            ? `${rejecting.instructor.name} — ${formatLeaveDayRange(rejecting.start_date, rejecting.end_date)}`
            : undefined
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            required
            maxLength={500}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why the request is being turned down — the instructor is emailed this."
          />
          <p className="text-xs text-muted">Required. It is sent to the instructor.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
          <Button
            onClick={submitRejection}
            disabled={!rejectReason.trim() || busyId === rejecting?.id}
          >
            Reject request
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
