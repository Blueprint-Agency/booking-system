"use client";

import { useMemo, useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarX, CheckCircle2, XCircle, Clock, Plus } from "lucide-react";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { QrBadge } from "@/components/account/qr-badge";
import { DateStub } from "@/components/account/date-stub";
import {
  usePtSessionsApi,
  type CancelPtRequestResult,
  type RawPtRequest,
} from "@/lib/pt-sessions";
import { useClientPackages } from "@/lib/use-client-packages";
import { cn, formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { useCancellationPolicy, type CancellationPolicy } from "@/lib/cancellation-policy";
import {
  cancelClosed,
  canStillCancel,
  ptCancelPrompt,
  ptCancelResult,
  ptPolicyNote,
  windowRefusal,
} from "@/lib/cancellation-copy";

// Slot times arrive as HH:MM:SS (Postgres time) — trim to HH:MM for display.
const hhmm = (t: string) => t.slice(0, 5);

type Tab = "pending" | "confirmed" | "past" | "cancelled";

type PtStatus =
  | "pending"
  | "scheduled"
  | "cancelled_before_scheduled"
  | "cancelled_after_scheduled"
  | "attended";
type RefundOutcome = "session_returned" | "forfeited" | "n_a" | null | undefined;

const TAB_LABEL: Record<Tab, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  past: "Past",
  cancelled: "Cancelled",
};

function inTab(r: RawPtRequest, t: Tab): boolean {
  switch (t) {
    case "pending":
      return r.status === "pending";
    case "confirmed":
      return r.status === "scheduled";
    case "past":
      return r.status === "attended";
    case "cancelled":
      return (
        r.status === "cancelled_before_scheduled" ||
        r.status === "cancelled_after_scheduled"
      );
  }
}

function statusBadge(status: PtStatus, refundOutcome?: RefundOutcome) {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "bg-accent/10 text-accent", icon: Clock };
    case "scheduled":
      return { label: "Confirmed", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "attended":
      return { label: "Attended", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "cancelled_before_scheduled":
      return { label: "Cancelled · session returned", tone: "bg-warm text-muted", icon: XCircle };
    case "cancelled_after_scheduled":
      if (refundOutcome === "session_returned") {
        return { label: "Cancelled · session returned", tone: "bg-warm text-muted", icon: XCircle };
      }
      if (refundOutcome === "forfeited") {
        return { label: "Cancelled · session lost", tone: "bg-error/15 text-error", icon: XCircle };
      }
      return { label: "Cancelled", tone: "bg-warm text-muted", icon: XCircle };
  }
}

export default function AccountPrivateSessionsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const justSubmitted = params.get("submitted") === "1";
  const ptApi = usePtSessionsApi();
  const { refetch: refetchPackages } = useClientPackages();
  const policy = useCancellationPolicy();
  // What the last cancel did — shown at the top, because the card itself moves
  // to the Cancelled tab the moment the list reloads.
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const [requests, setRequests] = useState<RawPtRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ptApi.listRequests();
      setRequests(result.pt_requests ?? []);
    } catch {
      setError("Could not load your PT sessions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [ptApi]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      requests
        .filter((r) => inTab(r, tab))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [requests, tab],
  );
  const tabs: Tab[] = ["pending", "confirmed", "past", "cancelled"];

  return (
    <>
      {/* No padding of its own — AccountShell already gutters the column, and
          doubling it left ~296px of content on a 360px phone. */}
      <div className="max-w-3xl">
        <AccountPageHeader
          title="Your PT sessions"
          action={
            <Link
              href="/private-sessions"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-ink px-5 min-h-[44px] text-sm font-semibold text-paper hover:bg-ink/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New request
            </Link>
          }
        />

        {justSubmitted && (
          <div role="status" className="mb-4 rounded-xl border border-sage/30 bg-sage/10 p-4 text-sm text-ink">
            Your request is in. We&apos;ll reach you on WhatsApp shortly to confirm the time.
          </div>
        )}

        {notice && (
          <div
            role="status"
            className={cn(
              "mb-4 rounded-xl border p-4 text-sm text-ink",
              notice.tone === "ok" ? "border-sage/30 bg-sage/10" : "border-warm bg-warm",
            )}
          >
            {notice.text}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your PT sessions">
            <Skeleton className="h-11 rounded-full" />
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            <SegmentedTabs
              label="PT sessions"
              tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
              value={tab}
              onChange={setTab}
              counts={Object.fromEntries(tabs.map((t) => [t, requests.filter((r) => inTab(r, t)).length]))}
            />

            <div>
              {filtered.length === 0 ? (
                <div className="rounded-2xl bg-card border border-ink/5 shadow-soft">
                  <EmptyState
                    icon={CalendarX}
                    title={emptyTitle(tab)}
                    description="Pick a few times that suit you and the studio confirms one."
                    cta={{ href: "/private-sessions", label: "Request a session" }}
                  />
                </div>
              ) : (
                <ul className="space-y-3">
                  {filtered.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      policy={policy}
                      onCancelled={async (result) => {
                        setNotice(ptCancelResult(result.refundOutcome, result.refundedSessions));
                        await load();
                        await refetchPackages();
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <p className="text-xs text-muted mt-8 leading-relaxed">
          {ptPolicyNote(policy)}
        </p>
      </div>
    </>
  );
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case "pending": return "No pending requests";
    case "confirmed": return "No confirmed sessions";
    case "past": return "No past sessions";
    case "cancelled": return "No cancelled requests";
  }
}

function RequestCard({
  request: r,
  policy,
  onCancelled,
}: {
  request: RawPtRequest;
  policy: CancellationPolicy | null;
  onCancelled: (result: CancelPtRequestResult) => Promise<void>;
}) {
  const status = r.status as PtStatus;
  const badge = statusBadge(status, r.refund_outcome);

  const slot0 = r.slots[0];
  const isPartner = r.role === "partner";
  // Requester sees their partner; partner sees who's hosting them.
  const coClientLine = isPartner
    ? `You're the partner · hosted by ${r.host_name ?? "the host"}`
    : r.co_client_name
      ? `Partner: ${r.co_client_name}`
      : null;
  const scheduled = r.session ?? null;
  // Only the requester (who owns the debited credits) can cancel. A scheduled
  // session closes to members at the studio's PT window — the server refuses
  // after that, so the button goes before it would.
  const windowClosed =
    r.status === "scheduled" &&
    !!scheduled &&
    !!policy &&
    !canStillCancel(scheduled.starts_at, policy.pt_window_hours);
  const canCancel = !isPartner && (r.status === "pending" || r.status === "scheduled");
  const cancelPrompt = ptCancelPrompt(r.status === "pending" ? "pending" : "scheduled", policy);

  return (
    <li className="rounded-2xl border border-ink/5 bg-card shadow-soft p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 pt-1 text-xs font-semibold text-muted">
          {r.session_type === "1on1" ? "1-on-1" : "2-on-1"}
          {r.class_name ? ` · ${r.class_name}` : ""}
          {r.location_name ? ` · ${r.location_name}` : ""}
        </p>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.tone}`}>
          <badge.icon size={12} /> {badge.label}
        </span>
      </div>
      <div className="mt-3 flex items-start gap-3 sm:gap-4">
        {(scheduled || slot0) && (
          <DateStub
            iso={scheduled ? scheduled.starts_at : `${slot0!.proposed_date.slice(0, 10)}T12:00:00+08:00`}
            tone={scheduled && r.status === "scheduled" ? "accent" : r.status === "pending" ? "default" : "muted"}
          />
        )}
        <div className="min-w-0 flex-1">
          {scheduled ? (
            <>
              <p className="font-semibold text-ink">
                {formatClassTime(scheduled.starts_at)}–{formatClassTime(scheduled.ends_at)}
              </p>
              <p className="text-sm text-muted mt-0.5">
                with {scheduled.instructor_name ?? "your instructor"}
                {scheduled.room_name ? ` · ${scheduled.room_name}` : ""}
              </p>
            </>
          ) : slot0 ? (
            <p className="font-semibold text-ink">
              {hhmm(slot0.start_time)}–{hhmm(slot0.end_time)}
              {r.slots.length > 1 ? (
                <span className="text-sm font-normal text-muted ml-2">+{r.slots.length - 1} more</span>
              ) : null}
            </p>
          ) : null}
          {coClientLine && (
            <p className="text-xs text-muted mt-1">{coClientLine}</p>
          )}
          {r.message && (
            <blockquote className="mt-2 rounded-lg bg-ink/[0.04] px-3 py-1.5 text-xs italic text-muted">
              {r.message}
            </blockquote>
          )}
          {scheduled && r.booking && (
            <div className="mt-3 flex items-center gap-2">
              <QrBadge
                value={r.booking.qr_token}
                label={`${r.session_type === "1on1" ? "1-on-1" : "2-on-1"} session`}
                subLabel={`${formatDate(scheduled.starts_at)} · ${r.booking.code}`}
              />
              <span className="text-xs text-muted">
                Check-in code: <span className="font-mono text-ink">{r.booking.code}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {r.status === "pending" && r.slots.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer py-2 text-sm font-semibold text-accent-deep hover:text-accent">
            View all proposed slots
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {r.slots.slice(1).map((s, i) => (
              <li key={i}>
                {formatDate(s.proposed_date)} · {hhmm(s.start_time)}–{hhmm(s.end_time)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canCancel && (
        <div className="mt-3 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 px-4 sm:px-5 py-2 border-t border-ink/5 flex justify-end">
          {windowClosed && policy ? (
            <span className="text-xs text-muted">{cancelClosed(policy.pt_window_hours)}</span>
          ) : (
            <CancelButton
              requestId={r.id}
              prompt={cancelPrompt}
              windowHours={policy?.pt_window_hours ?? null}
              onCancelled={onCancelled}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Why a PT cancel was refused, in words the member can act on. */
function cancelFailure(err: unknown, windowHours: number | null): string {
  const body =
    err instanceof ApiError && err.body && typeof err.body === "object"
      ? (err.body as Record<string, unknown>)
      : {};
  if (body.error === ERROR_CODES.cancellation_window_passed) {
    // The window the server refused under is the one that applied.
    const hours = typeof body.window_hours === "number" ? body.window_hours : windowHours;
    return hours !== null
      ? windowRefusal("session", hours)
      : "This session can no longer be cancelled in the app. Please contact the studio.";
  }
  return "Couldn't cancel. Please check your connection and try again.";
}

function CancelButton({
  requestId,
  prompt,
  windowHours,
  onCancelled,
}: {
  requestId: string;
  prompt: string;
  windowHours: number | null;
  onCancelled: (result: CancelPtRequestResult) => Promise<void>;
}) {
  const ptApi = usePtSessionsApi();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    let result: CancelPtRequestResult;
    try {
      result = await ptApi.cancelRequest(requestId);
    } catch (err) {
      setCancelError(cancelFailure(err, windowHours));
      setCancelling(false);
      setConfirming(false);
      return;
    }
    await onCancelled(result);
  }

  if (cancelError) {
    return <span className="text-xs text-error">{cancelError}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="-mr-2 min-h-[44px] rounded-full px-3 text-sm font-semibold text-muted hover:bg-error/5 hover:text-error transition-colors"
      >
        Cancel request
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2 py-1 text-sm">
      <span className="text-muted sm:flex-1">{prompt}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={cancelling}
          className="flex-1 sm:flex-none min-h-[44px] rounded-full border border-ink/10 px-4 font-semibold text-ink hover:border-ink/30 disabled:opacity-50"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="flex-1 sm:flex-none min-h-[44px] rounded-full bg-error text-inverse px-4 font-semibold hover:bg-error/90 disabled:opacity-50"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
