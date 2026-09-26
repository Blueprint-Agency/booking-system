"use client";

/**
 * Live "My Classes" — reads the member's own class bookings from the BE
 * (`GET /me/bookings/upcoming` + `/past`) and self-cancels via
 * `DELETE /me/bookings/:id`. The member's places in line (`GET /me/waitlist`)
 * sit above them, and are left via `DELETE /me/waitlist/:id`
 * (spec-waitlist.md §9). No mock state. See be-client.md §3/§4c.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CalendarX,
  X,
  CheckCircle2,
  XCircle,
  MapPin,
  UserRound,
  Hourglass,
} from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { DateStub } from "@/components/account/date-stub";
import { LeaveWaitlistDialog } from "@/components/booking/leave-waitlist-dialog";
import {
  leaveWaitlist,
  listWaitlist,
  waitlistRefusal,
  type ApiWaitlistEntry,
} from "@/lib/waitlist";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
import { CancelBookingDialog, type CancelOutcome } from "@/components/account/cancel-booking-dialog";
import { formatDate, cn } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { ApiError, apiErrorCode as errCode, useApi } from "@/lib/api";
import { useCancellationPolicy, type CancellationPolicy } from "@/lib/cancellation-policy";
import { cancelClosed, canStillCancel } from "@/lib/cancellation-copy";

export interface ApiBooking {
  booking_id: string;
  class_id: string;
  name: string;
  instructor: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  starts_at: string;
  ends_at: string;
  credit_cost: number;
  credits_used: number;
  package_kind: string | null;
  was_unlimited: boolean;
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  state: "confirmed" | "cancelled" | "no_show";
  qr_token: string;
  code: string;
}

interface ListResponse {
  bookings: ApiBooking[];
}

type Tab = "upcoming" | "ongoing" | "past";

const TAB_LABEL: Record<Tab, string> = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  past: "Past",
};

export function ClassBookings() {
  const api = useApi();
  const policy = useCancellationPolicy();

  const [upcoming, setUpcoming] = useState<ApiBooking[]>([]);
  const [past, setPast] = useState<ApiBooking[]>([]);
  const [waitlisted, setWaitlisted] = useState<ApiWaitlistEntry[]>([]);
  const [leaveTarget, setLeaveTarget] = useState<ApiWaitlistEntry | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [cancelTarget, setCancelTarget] = useState<ApiBooking | null>(null);
  const [banner, setBanner] = useState<
    { tone: "ok" | "warn" | "error"; text: string } | null
  >(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [u, p, w] = await Promise.all([
        api.get<ListResponse>("/me/bookings/upcoming"),
        api.get<ListResponse>("/me/bookings/past"),
        listWaitlist(api),
      ]);
      setUpcoming(u.bookings ?? []);
      setPast(p.bookings ?? []);
      setWaitlisted(w);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onCancelled(outcome: CancelOutcome) {
    const target = cancelTarget;
    setCancelTarget(null);
    setBanner({ tone: outcome.tone, text: outcome.text });
    if (outcome.cancelled && target) {
      setUpcoming((prev) => prev.filter((b) => b.booking_id !== target.booking_id));
    }
    if (outcome.stale) await reload();
  }

  async function confirmLeave() {
    if (!leaveTarget) return;
    const target = leaveTarget;
    setLeaving(true);
    try {
      await leaveWaitlist(api, target.id);
      setBanner({ tone: "ok", text: "Left the waitlist." });
      // Everyone behind the member moves up, so positions are re-read, not guessed.
      setWaitlisted(await listWaitlist(api).catch(() => waitlisted.filter((e) => e.id !== target.id)));
    } catch (err) {
      const out = waitlistRefusal(errCode(err), err instanceof ApiError ? err.body : null);
      setBanner({
        tone: "error",
        text: out?.kind === "message" ? out.msg : "Couldn't leave the waitlist. Please try again.",
      });
      await reload();
    } finally {
      setLeaving(false);
      setLeaveTarget(null);
    }
  }

  // The BE `past` list is everything with starts_at < now; split it into in-progress
  // (ends_at still in the future) vs genuinely finished.
  const now = Date.now();
  const ongoing = past.filter((b) => new Date(b.ends_at).getTime() > now);
  const ended = past.filter((b) => new Date(b.ends_at).getTime() <= now);
  const counts: Record<Tab, number> = {
    upcoming: upcoming.length,
    ongoing: ongoing.length,
    past: ended.length,
  };
  const rows = tab === "upcoming" ? upcoming : tab === "ongoing" ? ongoing : ended;
  const hasAny = upcoming.length > 0 || past.length > 0 || waitlisted.length > 0;

  return (
    <div>
      <AccountPageHeader
        title="Your classes"
        description="Show your QR at the desk to check in."
      />

      {banner && (
        <div
          role="status"
          className={cn(
            "mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm",
            banner.tone === "ok" && "border-sage/25 bg-sage/10 text-ink",
            banner.tone === "warn" && "border-warm bg-warm text-ink",
            banner.tone === "error" && "border-error/25 bg-error/10 text-ink",
          )}
        >
          <span>{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            className="shrink-0 text-muted hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <ContentLoading label="Loading your classes" />
      ) : loadError ? (
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft p-8 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load your classes.</p>
          <button
            onClick={reload}
            className="mt-4 min-h-[44px] rounded-full border border-ink/10 px-5 text-sm font-semibold hover:border-accent transition-colors"
          >
            Try again
          </button>
        </div>
      ) : !hasAny ? (
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft">
          <EmptyState
            icon={CalendarX}
            title="No classes yet"
            description="Book a class from the schedule and it shows up here with its check-in QR."
            cta={{ href: "/", label: "See the schedule" }}
          />
        </div>
      ) : (
        <>
          {waitlisted.length > 0 && (
            <section aria-labelledby="waitlisted-heading" className="mb-6">
              <h3
                id="waitlisted-heading"
                className="mb-2 text-xs font-medium uppercase tracking-wider text-muted"
              >
                Waitlisted
              </h3>
              <div className="space-y-3">
                {waitlisted.map((e) => (
                  <WaitlistCard key={e.id} entry={e} onLeave={setLeaveTarget} />
                ))}
              </div>
            </section>
          )}

          <SegmentedTabs
            label="Classes"
            tabs={(["upcoming", "ongoing", "past"] as Tab[]).map((t) => ({ value: t, label: TAB_LABEL[t] }))}
            value={tab}
            onChange={setTab}
            counts={counts}
          />

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 p-8 text-center text-sm text-muted">
              {tab === "upcoming"
                ? "Nothing on the schedule."
                : tab === "ongoing"
                  ? "No classes in progress right now."
                  : "No past classes yet."}
            </div>
          ) : tab === "past" ? (
            <div className="rounded-2xl bg-card border border-ink/5 shadow-soft divide-y divide-ink/5">
              {rows.map((b) => (
                <PastRow key={b.booking_id} booking={b} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((b, i) => (
                <UpcomingCard
                  key={b.booking_id}
                  booking={b}
                  featured={tab === "upcoming" && i === 0}
                  ongoing={tab === "ongoing"}
                  policy={policy}
                  onCancel={setCancelTarget}
                />
              ))}
            </div>
          )}
        </>
      )}

      {leaveTarget && (
        <LeaveWaitlistDialog
          classTitle={leaveTarget.name}
          startsAt={leaveTarget.starts_at}
          position={leaveTarget.position}
          leaving={leaving}
          onConfirm={confirmLeave}
          onClose={() => setLeaveTarget(null)}
        />
      )}

      {cancelTarget && (
        <CancelBookingDialog
          booking={cancelTarget}
          policy={policy}
          onDone={onCancelled}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}

function MetaLine({ booking }: { booking: ApiBooking }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
      {booking.instructor && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-ink/30" />
          <span className="truncate">{booking.instructor.name}</span>
        </span>
      )}
      {booking.location && (
        <>
          <span aria-hidden className="text-ink/20">·</span>
          <span className="inline-flex items-center gap-1 min-w-0">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" />
            <span className="truncate">{booking.location.name}</span>
          </span>
        </>
      )}
    </div>
  );
}

function UpcomingCard({
  booking,
  featured,
  ongoing = false,
  policy,
  onCancel,
}: {
  booking: ApiBooking;
  featured: boolean;
  ongoing?: boolean;
  policy: CancellationPolicy | null;
  onCancel: (b: ApiBooking) => void;
}) {
  // Until the studio's window is known, offer the cancel on anything not yet
  // started and let the server decide — a guessed number is how members were
  // told the wrong one before.
  const open = policy
    ? canStillCancel(booking.starts_at, policy.class_window_hours)
    : !ongoing;
  return (
    <div
      className={cn(
        "rounded-2xl bg-card border shadow-soft",
        ongoing ? "border-sage/40" : featured ? "border-accent/25" : "border-ink/5",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4 p-4">
        <DateStub iso={booking.starts_at} tone={featured || ongoing ? "accent" : "default"} />
        <div className="min-w-0 flex-1">
          {(ongoing || booking.check_in_state === "attended") && (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {ongoing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sage">
                  <span className="h-1.5 w-1.5 rounded-full bg-sage animate-pulse" />
                  In progress
                </span>
              )}
              {booking.check_in_state === "attended" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sage">
                  <CheckCircle2 className="h-3 w-3" />
                  Checked in
                </span>
              )}
            </div>
          )}
          <p className="font-semibold text-ink break-words leading-snug">{booking.name}</p>
          <p className="mt-0.5 text-sm font-medium text-ink/80">{formatClassTime(booking.starts_at)}</p>
          <MetaLine booking={booking} />
        </div>
        <QrBadge
          value={booking.qr_token}
          label={booking.name}
          subLabel={`${formatDate(booking.starts_at)} · ${booking.code}`}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-ink/5 px-4 min-h-[48px]">
        <span className="text-xs text-muted font-mono tracking-wide">{booking.code}</span>
        {open ? (
          <button
            onClick={() => onCancel(booking)}
            className="-mr-2 inline-flex items-center gap-1.5 min-h-[44px] rounded-full px-3 text-sm font-semibold text-muted hover:bg-error/5 hover:text-error transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        ) : (
          <span className="text-xs text-muted text-right">
            {policy ? cancelClosed(policy.class_window_hours) : "Cancellation closed"}
          </span>
        )}
      </div>
    </div>
  );
}

function WaitlistCard({
  entry,
  onLeave,
}: {
  entry: ApiWaitlistEntry;
  onLeave: (e: ApiWaitlistEntry) => void;
}) {
  return (
    <div className="rounded-2xl bg-paper border border-warning/40 p-4">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink truncate">{entry.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1 min-w-0">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-ink/30" />
              <span className="truncate">{entry.instructor}</span>
            </span>
            <span aria-hidden className="text-ink/20">·</span>
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" />
              <span className="truncate">{entry.location}</span>
            </span>
          </div>
          <div className="mt-1 text-xs text-muted sm:hidden">
            {formatDate(entry.starts_at)} · {formatClassTime(entry.starts_at)}
          </div>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="text-sm text-ink font-medium">{formatDate(entry.starts_at)}</p>
          <p className="text-sm text-muted">{formatClassTime(entry.starts_at)}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-ink">
          <Hourglass className="h-3.5 w-3.5 text-ink/50" aria-hidden />
          #{entry.position} in line
        </span>
        <button
          onClick={() => onLeave(entry)}
          className="inline-flex items-center gap-1.5 min-h-[32px] text-xs font-medium text-muted hover:text-error transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Leave waitlist
        </button>
      </div>
    </div>
  );
}

function PastRow({ booking }: { booking: ApiBooking }) {
  const cancelled = booking.state === "cancelled";
  const attended = booking.check_in_state === "attended";
  const noShow = booking.check_in_state === "no_show" || booking.state === "no_show";
  return (
    <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
      <DateStub iso={booking.starts_at} tone="muted" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink truncate">{booking.name}</p>
        <p className="text-sm text-muted truncate">
          {formatClassTime(booking.starts_at)}
          {booking.instructor ? ` · ${booking.instructor.name}` : ""}
        </p>
      </div>
      {cancelled ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warm px-2.5 py-1 text-xs font-medium text-muted">
          <X className="w-3.5 h-3.5" />
          Cancelled
        </span>
      ) : attended ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sage/15 px-2.5 py-1 text-xs font-medium text-sage">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Attended
        </span>
      ) : noShow ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warm px-2.5 py-1 text-xs font-medium text-muted">
          <XCircle className="w-3.5 h-3.5" />
          No-show
        </span>
      ) : null}
    </div>
  );
}
