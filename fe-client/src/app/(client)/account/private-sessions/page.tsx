"use client";

import { useMemo, useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX, CheckCircle2, XCircle, Clock } from "lucide-react";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { QrBadge } from "@/components/account/qr-badge";
import { usePtSessionsApi, type RawPtRequest } from "@/lib/pt-sessions";
import { useClientPackages } from "@/lib/use-client-packages";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";

// Slot times arrive as HH:MM:SS (Postgres time) — trim to HH:MM for display.
const hhmm = (t: string) => t.slice(0, 5);

type Tab = "pending" | "confirmed" | "past" | "cancelled";

type PtStatus =
  | "pending"
  | "scheduled"
  | "cancelled_before_scheduled"
  | "cancelled_after_scheduled"
  | "attended";

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

function statusBadge(status: PtStatus) {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "bg-accent/10 text-accent", icon: Clock };
    case "scheduled":
      return { label: "Confirmed", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "attended":
      return { label: "Attended", tone: "bg-sage/15 text-sage", icon: CheckCircle2 };
    case "cancelled_before_scheduled":
      return { label: "Cancelled · refunded", tone: "bg-warm text-muted", icon: XCircle };
    case "cancelled_after_scheduled":
      return { label: "Cancelled · forfeited", tone: "bg-error/15 text-error", icon: XCircle };
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
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <SectionHeading eyebrow="Private sessions" title="Your PT sessions" />

        {justSubmitted && (
          <div className="mt-4 rounded-xl border border-sage/30 bg-sage/10 p-4 text-sm text-ink">
            Your request is in. We&apos;ll reach you on WhatsApp shortly to confirm the time.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-10 text-sm text-muted text-center">Loading…</div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {tabs.map((t) => {
                const count = requests.filter((r) => inTab(r, t)).length;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      tab === t
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-ink/10 bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {TAB_LABEL[t]} ({count})
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={CalendarX}
                  title={emptyTitle(tab)}
                  description="Submit a request to get started."
                  cta={{ href: "/private-sessions", label: "Request a session" }}
                />
              ) : (
                <ul className="space-y-3">
                  {filtered.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      onCancelled={async () => {
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

        <p className="text-xs text-muted mt-10 leading-relaxed">
          Pending requests refund their session credits when cancelled. Cancelling after the studio has scheduled the session does not refund credits.
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
  onCancelled,
}: {
  request: RawPtRequest;
  onCancelled: () => Promise<void>;
}) {
  const status = r.status as PtStatus;
  const badge = statusBadge(status);

  const slot0 = r.slots[0];
  const coClientLine = r.co_client_name ? `Partner: ${r.co_client_name}` : null;
  const canCancel = r.status === "pending" || r.status === "scheduled";
  const refunds = r.status === "pending";
  const scheduled = r.session ?? null;

  return (
    <li className="rounded-2xl border border-ink/10 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted">
            {r.session_type === "1on1" ? "1-on-1" : "2-on-1"}
            {r.class_name ? ` · ${r.class_name}` : ""}
            {r.location_name ? ` · ${r.location_name}` : ""}
          </p>
          {scheduled ? (
            <>
              <p className="font-serif text-lg text-ink mt-1">
                {formatDate(scheduled.starts_at)} · {formatClassTime(scheduled.starts_at)}–
                {formatClassTime(scheduled.ends_at)}
              </p>
              <p className="text-sm text-muted mt-0.5">
                with {scheduled.instructor_name ?? "your instructor"}
                {scheduled.room_name ? ` · ${scheduled.room_name}` : ""}
              </p>
            </>
          ) : slot0 ? (
            <p className="font-serif text-lg text-ink mt-1">
              {formatDate(slot0.proposed_date)} · {hhmm(slot0.start_time)}–{hhmm(slot0.end_time)}
              {r.slots.length > 1 ? (
                <span className="text-sm text-muted ml-2">+{r.slots.length - 1} more</span>
              ) : null}
            </p>
          ) : null}
          {coClientLine && (
            <p className="text-xs text-muted mt-1">{coClientLine}</p>
          )}
          {r.message && (
            <blockquote className="mt-2 rounded-md border-l-2 border-ink/10 bg-paper px-3 py-1.5 text-xs italic text-muted">
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
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${badge.tone}`}>
          <badge.icon size={12} /> {badge.label}
        </span>
      </div>

      {r.status === "pending" && r.slots.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-accent hover:text-accent-deep">
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
        <div className="mt-4 flex justify-end">
          <CancelButton requestId={r.id} refunds={refunds} onCancelled={onCancelled} />
        </div>
      )}
    </li>
  );
}

function CancelButton({
  requestId,
  refunds,
  onCancelled,
}: {
  requestId: string;
  refunds: boolean;
  onCancelled: () => Promise<void>;
}) {
  const ptApi = usePtSessionsApi();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      await ptApi.cancelRequest(requestId);
      await onCancelled();
    } catch {
      setCancelError("Cancel failed. Please try again.");
      setCancelling(false);
      setConfirming(false);
    }
  }

  if (cancelError) {
    return <span className="text-xs text-error">{cancelError}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted hover:text-error transition-colors"
      >
        Cancel request
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted">
        {refunds ? "Cancel and refund credits?" : "Cancel without refund?"}
      </span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={cancelling}
        className="rounded-full border border-ink/10 px-2.5 py-1 text-muted hover:text-ink disabled:opacity-50"
      >
        Keep
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={cancelling}
        className="rounded-full bg-error text-paper px-2.5 py-1 hover:bg-error/90 disabled:opacity-50"
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}
