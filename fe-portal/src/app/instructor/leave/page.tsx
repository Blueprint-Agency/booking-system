"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarOff, Loader2, Paperclip, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
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
  type HalfDay,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/leave";

/**
 * My leave — both balances, the submission form, and my own request history.
 *
 * Every rule (balance, backdating, clashes) is enforced by the backend and its
 * refusal arrives as a ready-made sentence, which is what this page shows. It
 * deliberately re-derives none of them: the `min` on the date inputs is a hint
 * so the common mistake is hard to make, not the enforcement.
 */

interface ApiBalance {
  type: LeaveType;
  /** The yearly figure on my profile. */
  assigned_days: number;
  /** Part of the Pool, brought in from last year. Only annual ever carries. */
  carried_days: number;
  /** What leave is drawn from this year. Normally assigned + carried, but an
   *  admin's adjustment can move it, so it is sent rather than added up here. */
  pool_days: number;
  taken_days: number;
  pending_days: number;
  remaining_days: number;
}

interface ApiLeaveRequest {
  id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  half_day: HalfDay;
  days: number;
  leave_year: number;
  status: LeaveStatus;
  reason: string;
  decision_reason: string | null;
  created_at: string;
  /** The key is never sent — only whether there is a certificate to ask for. */
  has_certificate: boolean;
}

/** What the server accepts. The `accept` attribute below is the same list as a
 *  convenience; the refusal that matters comes from the backend. */
const CERT_ACCEPT = "image/jpeg,image/png,application/pdf";

/** Spelled out rather than CSS-capitalised: "who's away" does not survive
 *  `text-transform: capitalize` intact. */
const VIEW_LABEL = { requests: "Requests", away: "Who's away" } as const;

interface ApiLeaveResponse {
  leave_year: number;
  balances: ApiBalance[];
  requests: ApiLeaveRequest[];
}

function BalanceCard({ balance }: { balance: ApiBalance }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="text-xs text-muted">{LEAVE_TYPE_LABEL[balance.type]} leave</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {balance.remaining_days}
        </span>
        <span className="text-sm text-muted">of {balance.pool_days} days left</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {balance.taken_days} approved
        {balance.pending_days > 0 && `, ${balance.pending_days} awaiting a decision`}
      </p>
      {/* Named only when there is some: an instructor should be able to tell a
          one-off surplus from their yearly assigned days. Medical never carries. */}
      {balance.carried_days > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          {balance.assigned_days} assigned, plus {balance.carried_days}{" "}
          {balance.carried_days === 1 ? "day" : "days"} carried over from last year.
        </p>
      )}
    </div>
  );
}

export default function InstructorLeavePage() {
  const { api } = useWorkspace();
  const [data, setData] = useState<ApiLeaveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Requests is the default: this page is where an instructor asks for leave
   *  and checks what happened to it. Who's away is for judging whether asking
   *  for a given week is realistic at all. */
  const [view, setView] = useState<"requests" | "away">("requests");

  const [type, setType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState<HalfDay>("none");
  const [reason, setReason] = useState("");
  // Optional, always: a medical request with no certificate is still filed. The
  // second input is the "I'll bring the MC later" path from the history table.
  const certInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);

  // Half days are single-date only (the backend refuses them on a range), so
  // the control is offered only then and the marker is dropped otherwise.
  const singleDate = !endDate || endDate === startDate;
  const requestedHalf: HalfDay = singleDate ? halfDay : "none";

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ApiLeaveResponse>("/portal/instructor/leave"));
    } catch (err) {
      setError(leaveErrorMessage(err, "Couldn't load your leave"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The upload is its own call, so a certificate that is refused (wrong type,
   *  too big) never costs the request that was already filed. */
  async function uploadCertificate(id: string, file: File) {
    if (!api) return;
    const form = new FormData();
    form.append("file", file);
    await api.post(`/portal/instructor/leave/${id}/certificate`, form);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSubmitting(true);
    const certificate = type === "medical" ? (certInput.current?.files?.[0] ?? null) : null;
    try {
      const created = await api.post<{ id: string }>("/portal/instructor/leave", {
        type,
        start_date: startDate,
        // A single date is a one-day range — don't make people type it twice.
        end_date: endDate || startDate,
        half_day: requestedHalf,
        reason: reason.trim(),
      });
      if (certificate) {
        try {
          await uploadCertificate(created.id, certificate);
          toast.success("Leave request submitted with your certificate.");
        } catch (err) {
          // The request stands; only the file failed. Say so, and leave the
          // "Attach" action in the history row to try again with.
          toast.error(
            leaveErrorMessage(err, "Request submitted, but the certificate didn't upload"),
          );
        }
      } else {
        toast.success("Leave request submitted.");
      }
      setStartDate("");
      setEndDate("");
      setHalfDay("none");
      setReason("");
      if (certInput.current) certInput.current.value = "";
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't submit that request"));
    } finally {
      setSubmitting(false);
    }
  }

  /** Attach after the fact — file the leave at 6am, produce the MC later. */
  async function handleAttachPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = attachTo;
    e.target.value = "";
    setAttachTo(null);
    if (!file || !id) return;
    setBusyId(id);
    try {
      await uploadCertificate(id, file);
      toast.success("Certificate attached.");
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't attach that certificate"));
    } finally {
      setBusyId(null);
    }
  }

  async function openCertificate(id: string) {
    if (!api) return;
    try {
      await openSignedUrl(api, `/portal/instructor/leave/${id}/certificate`);
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't open that certificate"));
    }
  }

  async function handleTransition(id: string, action: "withdraw" | "cancel") {
    if (!api) return;
    setBusyId(id);
    try {
      await api.post(`/portal/instructor/leave/${id}/${action}`);
      toast.success(action === "withdraw" ? "Request withdrawn." : "Leave cancelled.");
      await load();
    } catch (err) {
      toast.error(leaveErrorMessage(err, "Couldn't update that request"));
    } finally {
      setBusyId(null);
    }
  }

  // "Not started" mirrors the backend rule: a cancel is only offered for leave
  // that begins after today. The server refuses it either way.
  const notStarted = (r: ApiLeaveRequest) => r.start_date > todayIso();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My leave"
        description="Annual, medical and study leave, and what you have left this year. An admin approves or rejects each request."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          {error}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <div className="inline-flex items-center rounded-md border border-border bg-paper p-0.5">
          {(["requests", "away"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-7 rounded px-3 text-xs font-medium transition-colors ${
                view === v ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
              }`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {/* The studio's absences. Colleagues' rows arrive with no type or reason
          on them — the backend never sends those to an instructor. */}
      {view === "away" ? (
        <LeaveCalendar />
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !data ? null : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {data.balances.map((b) => (
              <BalanceCard key={b.type} balance={b} />
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="mb-6 space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft"
          >
            <header>
              <h2 className="text-base font-semibold text-ink">Request leave</h2>
              <p className="mt-0.5 text-xs text-muted">
                A single date can be a half day, morning or afternoon — a range is full days
                only. Annual and study leave must start after today; medical leave can be
                backdated up to 7 days. Every day in the range counts, weekends included.
              </p>
            </header>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="leave-type">Type</Label>
                <Select
                  id="leave-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as LeaveType)}
                >
                  <option value="annual">Annual</option>
                  <option value="medical">Medical</option>
                  <option value="study">Study</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">First day</Label>
                <Input
                  id="leave-start"
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">Last day</Label>
                <Input
                  id="leave-end"
                  type="date"
                  min={startDate || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="Same day"
                />
              </div>
            </div>

            {singleDate && (
              <div className="space-y-1.5 sm:max-w-[16rem]">
                <Label htmlFor="leave-half">How much of the day</Label>
                <Select
                  id="leave-half"
                  value={halfDay}
                  onChange={(e) => setHalfDay(e.target.value as HalfDay)}
                >
                  <option value="none">Full day (1 day)</option>
                  <option value="morning">Morning only, until 1pm (0.5 days)</option>
                  <option value="afternoon">Afternoon only, from 1pm (0.5 days)</option>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason</Label>
              <Textarea
                id="leave-reason"
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why you need these days — the admin sees this when deciding."
              />
            </div>

            {/* Medical only — annual leave has nothing to evidence. Optional:
                file the request now and attach the MC from the list later. */}
            {type === "medical" && (
              <div className="space-y-1.5">
                <Label htmlFor="leave-certificate">Medical certificate (optional)</Label>
                <Input
                  id="leave-certificate"
                  ref={certInput}
                  type="file"
                  accept={CERT_ACCEPT}
                  className="h-auto py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-warm file:px-2.5 file:py-1 file:text-xs file:text-ink"
                />
                <p className="text-xs text-muted">
                  JPG, PNG or PDF, up to 5MB. Only admins can open it. You can attach one later
                  from the list below.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !startDate || !reason.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Submit request
                  </>
                )}
              </Button>
            </div>
          </form>

          {data.requests.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title="No leave requests yet"
              description="Requests you submit appear here with their status."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2.5 font-medium">Dates</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Days</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.requests.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-warm/40">
                      <td className="px-3 py-2.5">
                        <span className="text-ink">
                          {formatLeaveDayRange(r.start_date, r.end_date)}
                          {LEAVE_HALF_DAY_SUFFIX[r.half_day]}
                        </span>
                        <p className="mt-0.5 max-w-xs truncate text-xs text-muted">{r.reason}</p>
                        {r.decision_reason && (
                          <p className="mt-0.5 max-w-xs text-xs text-muted">
                            Admin: {r.decision_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted">
                        {LEAVE_TYPE_LABEL[r.type]}
                        {r.type === "medical" && (
                          <button
                            type="button"
                            className="mt-0.5 flex items-center gap-1 text-xs text-accent hover:underline"
                            onClick={() =>
                              r.has_certificate
                                ? void openCertificate(r.id)
                                : (setAttachTo(r.id), attachInput.current?.click())
                            }
                          >
                            <Paperclip className="h-3 w-3" />
                            {r.has_certificate ? "Certificate" : "Attach MC"}
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
                        {r.status === "pending" || (r.status === "approved" && notStarted(r)) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === r.id}
                            onClick={() =>
                              handleTransition(r.id, r.status === "pending" ? "withdraw" : "cancel")
                            }
                          >
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : r.status === "pending" ? (
                              "Withdraw"
                            ) : (
                              "Cancel"
                            )}
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
        </>
      )}

      {/* One picker for every "Attach MC" in the table above — the row it
          belongs to is `attachTo`, set just before it is clicked. */}
      <input
        ref={attachInput}
        type="file"
        accept={CERT_ACCEPT}
        hidden
        onChange={handleAttachPicked}
      />

    </div>
  );
}
