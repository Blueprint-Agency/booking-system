"use client";

import { useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX, CheckCircle2, XCircle, Clock } from "lucide-react";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { EmptyState } from "@/components/ui/empty-state";
import {
  cancelPtRequest,
  usePtRequests,
  type LocalPtRequest,
  type LocalPtRequestStatus,
} from "@/lib/pt-requests-mock";

type Tab = "pending" | "confirmed" | "past" | "cancelled";

const TAB_LABEL: Record<Tab, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  past: "Past",
  cancelled: "Cancelled",
};

function inTab(r: LocalPtRequest, t: Tab): boolean {
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

function statusBadge(status: LocalPtRequestStatus) {
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
  const requests = usePtRequests();
  const [tab, setTab] = useState<Tab>(justSubmitted ? "pending" : "pending");

  const filtered = useMemo(
    () =>
      requests
        .filter((r) => inTab(r, tab))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests, tab],
  );
  const tabs: Tab[] = ["pending", "confirmed", "past", "cancelled"];

  return (
    <>
      <AccountMobileNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <SectionHeading eyebrow="Private sessions" title="Your PT sessions" />

        {justSubmitted && (
          <div className="mt-4 rounded-xl border border-sage/30 bg-sage/10 p-4 text-sm text-ink">
            Your request is in. We&apos;ll reach you on WhatsApp shortly to confirm the time.
          </div>
        )}

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
                <RequestCard key={r.id} request={r} />
              ))}
            </ul>
          )}
        </div>

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

function RequestCard({ request: r }: { request: LocalPtRequest }) {
  const badge = statusBadge(r.status);
  const partnerLine = r.partner
    ? r.partner.kind === "existing"
      ? `Partner: ${r.partner.name}`
      : `Partner: ${r.partner.name} (${r.partner.email}) — pending account`
    : null;

  const canCancel = r.status === "pending" || r.status === "scheduled";
  const refunds = r.status === "pending";

  return (
    <li className="rounded-2xl border border-ink/10 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted">
            {r.sessionType === "1on1" ? "1-on-1" : "2-on-1"} · {r.className}
            {r.locationName ? ` · ${r.locationName}` : ""}
          </p>
          {r.scheduled ? (
            <p className="font-serif text-lg text-ink mt-1">
              {r.scheduled.date} · {r.scheduled.startTime}–{r.scheduled.endTime}
            </p>
          ) : (
            <p className="font-serif text-lg text-ink mt-1">
              {r.slots[0]?.proposedDate} · {r.slots[0]?.startTime}–{r.slots[0]?.endTime}
              {r.slots.length > 1 ? (
                <span className="text-sm text-muted ml-2">+{r.slots.length - 1} more</span>
              ) : null}
            </p>
          )}
          {r.scheduled && (
            <p className="text-xs text-muted mt-1">
              {r.scheduled.instructorName} · {r.scheduled.locationName}
            </p>
          )}
          {partnerLine && (
            <p className="text-xs text-muted mt-1">{partnerLine}</p>
          )}
          {r.message && (
            <blockquote className="mt-2 rounded-md border-l-2 border-ink/10 bg-paper px-3 py-1.5 text-xs italic text-muted">
              {r.message}
            </blockquote>
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
                {s.proposedDate} · {s.startTime}–{s.endTime}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canCancel && (
        <div className="mt-4 flex justify-end">
          <CancelButton requestId={r.id} refunds={refunds} />
        </div>
      )}
    </li>
  );
}

function CancelButton({ requestId, refunds }: { requestId: string; refunds: boolean }) {
  const [confirming, setConfirming] = useState(false);
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
        className="rounded-full border border-ink/10 px-2.5 py-1 text-muted hover:text-ink"
      >
        Keep
      </button>
      <button
        type="button"
        onClick={() => cancelPtRequest(requestId)}
        className="rounded-full bg-error text-paper px-2.5 py-1 hover:bg-error/90"
      >
        Cancel
      </button>
    </div>
  );
}
