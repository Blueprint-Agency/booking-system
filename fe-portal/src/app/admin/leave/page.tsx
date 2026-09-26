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
 * The leave queue — every staff member's requests, admins' beside
 * instructors', and the decision on each.
 *
 * Admins land here; the backend gates the mount, so there is
 * no role branch in this file. Any admin decides any request, their own
 * included. Whether a request can be approved, rejected or revoked is the
 * server's call — the buttons below mirror those rules so the common mistake is
 * hard to make, and the server refuses regardless.
 */

interface ApiAdminLeaveRequest {
  id: string;
  /** Who filed it. */
  applicant: { id: string; name: string; email: string; role: "admin" | "instructor" };
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
  /** Whether there is a Supporting Document to ask the server for. */
  has_supporting_document: boolean;
}

type Filter = LeaveStatus | "all";

const FILTERS: Filter[] = ["pending", "approved", "rejected", "all"];

const FILTER_LABEL: Record<Filter, string> = { ...LEAVE_STATUS_LABEL, all: "All" };

const ROLE_LABEL = { admin: "Admin", instructor: "Instructor" } as const;
const ROLE_TONE = { admin: "accent", instructor: "cyan" } as const;

/** The applicant's name, role and email. The role is shown because the queue
 *  holds admins' requests alongside instructors'. */
function Applicant({ applicant }: { applicant: ApiAdminLeaveRequest["applicant"] }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="break-words font-medium text-ink">{applicant.name}</span>
        <Badge tone={ROLE_TONE[applicant.role]}>{ROLE_LABEL[applicant.role]}</Badge>
      </div>
      <div className="truncate text-xs text-muted">{applicant.email}</div>
    </div>
  );
}

export default function AdminLeavePage() {
  const { api, currentStaff } = useWorkspace();
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
        `Revoke ${r.applicant.name}'s approved leave on ${formatLeaveDayRange(r.start_date, r.end_date)}? The days go back into their balance.`,
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
      // Deciding your own request sends no email — the backend skips it.
      toast.success(
        rejecting.applicant.id === currentStaff?.id
          ? "Request rejected."
          : "Request rejected. They have been emailed the reason.",
      );
      setRejecting(null);
      setRejectReason("");
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't reject that request"));
    } finally {
      setBusyId(null);
    }
  }

  /** The document is never in this payload — the server mints a short-lived
   *  signed URL per click, and the object is unreachable without one. */
  async function openDocument(id: string) {
    if (!api) return;
    try {
      await openSignedUrl(api, `/portal/admin/leave/${id}/document`);
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't open that document"));
    }
  }

  // Mirrors the server rule: approved leave is only revocable before it starts.
  const notStarted = (r: ApiAdminLeaveRequest) => r.start_date > todayIso();

  // One decision control, rendered in the phone card and the desktop table.
  const decision = (r: ApiAdminLeaveRequest) =>
    busyId === r.id ? (
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
    );

  const documentButton = (r: ApiAdminLeaveRequest) =>
    r.has_supporting_document && (
      <button
        type="button"
        className="mt-0.5 flex min-h-8 items-center gap-1 text-xs text-accent hover:underline"
        onClick={() => void openDocument(r.id)}
      >
        <Paperclip className="h-3 w-3" /> Document
      </button>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Leave"
        description="Leave requests from instructors and admins. Any admin can decide any request, their own included. Approving makes the absence binding — an instructor on approved leave can no longer be scheduled."
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
                  className={`h-9 rounded-full border px-3 text-xs transition sm:h-8 ${
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
              className={`h-8 rounded px-3 text-xs font-medium capitalize transition-colors sm:h-7 ${
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
        <div className="rounded-xl border border-border bg-card shadow-soft">
          {/* Mobile cards — the queue is cleared from a phone too, so the
              decision buttons sit on the card rather than off-screen in a
              sideways-scrolling table. */}
          <ul className="divide-y divide-border md:hidden">
            {filtered.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <Applicant applicant={r.applicant} />
                  <span className="shrink-0">
                    <Badge tone={LEAVE_STATUS_TONE[r.status]}>
                      {LEAVE_STATUS_LABEL[r.status]}
                    </Badge>
                  </span>
                </div>
                <div>
                  <div className="text-ink">
                    {formatLeaveDayRange(r.start_date, r.end_date)}
                    {LEAVE_HALF_DAY_SUFFIX[r.half_day]}
                  </div>
                  <div className="text-xs text-muted">
                    {LEAVE_TYPE_LABEL[r.type]} ·{" "}
                    <span className="tabular-nums">{r.days}</span> {r.days === 1 ? "day" : "days"}
                  </div>
                  {documentButton(r)}
                  {r.reason && (
                    <p className="mt-1 break-words text-xs text-muted">{r.reason}</p>
                  )}
                  {r.decision_reason && (
                    <p className="mt-0.5 break-words text-xs text-muted">
                      Decision: {r.decision_reason}
                    </p>
                  )}
                </div>
                <div className="flex justify-end">{decision(r)}</div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            {/* Without a min-width the wrapper never scrolls — the table just
                shrinks and the six columns wrap to single characters. */}
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2.5 font-medium">Staff member</th>
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
                      <Applicant applicant={r.applicant} />
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
                      {documentButton(r)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted">{r.days}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={LEAVE_STATUS_TONE[r.status]}>
                        {LEAVE_STATUS_LABEL[r.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">{decision(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Reject leave request"
        description={
          rejecting
            ? `${rejecting.applicant.name} — ${formatLeaveDayRange(rejecting.start_date, rejecting.end_date)}`
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
            placeholder="Why the request is being turned down — the person who filed it is emailed this."
          />
          <p className="text-xs text-muted">Required. It is sent to the person who filed it.</p>
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
