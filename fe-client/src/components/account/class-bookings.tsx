"use client";

/**
 * Live "My Classes" — reads the member's own class bookings from the BE
 * (`GET /me/bookings/upcoming` + `/past`) and self-cancels via
 * `DELETE /me/bookings/:id`. No mock state. See be-client.md §3/§4c.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CalendarX,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  MapPin,
  UserRound,
} from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, cn } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { ApiError, useApi } from "@/lib/api";
import { useClientPackages } from "@/lib/use-client-packages";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { CLASS_CANCELLATION_HOURS } from "@/data/policy";

/** A member may self-cancel only up to this many hours before the class starts. */
function canCancel(startsAt: string): boolean {
  return new Date(startsAt).getTime() - Date.now() >= CLASS_CANCELLATION_HOURS * 3600_000;
}

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

function errCode(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.body &&
    typeof err.body === "object" &&
    "error" in err.body
  ) {
    return String((err.body as { error: unknown }).error);
  }
  return "";
}

export function ClassBookings() {
  const api = useApi();
  const { refetch: refetchPackages } = useClientPackages();

  const [upcoming, setUpcoming] = useState<ApiBooking[]>([]);
  const [past, setPast] = useState<ApiBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [cancelTarget, setCancelTarget] = useState<ApiBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useBodyScrollLock(Boolean(cancelTarget));
  const [banner, setBanner] = useState<
    { tone: "ok" | "warn" | "error"; text: string } | null
  >(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [u, p] = await Promise.all([
        api.get<ListResponse>("/me/bookings/upcoming"),
        api.get<ListResponse>("/me/bookings/past"),
      ]);
      setUpcoming(u.bookings ?? []);
      setPast(p.bookings ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    const target = cancelTarget;
    setCancelling(true);
    try {
      const res = await api.del<{ refund_outcome: string; refund_fired: boolean }>(
        `/me/bookings/${target.booking_id}`,
      );
      setUpcoming((prev) => prev.filter((b) => b.booking_id !== target.booking_id));
      if (res.refund_outcome === "credit_returned") {
        const n = target.credits_used || 1;
        setBanner({
          tone: "ok",
          text: `Booking cancelled · ${n} credit${n === 1 ? "" : "s"} returned.`,
        });
      } else if (res.refund_outcome === "forfeited") {
        setBanner({
          tone: "warn",
          text: "Booking cancelled · credit forfeited per cancellation policy.",
        });
      } else {
        setBanner({ tone: "ok", text: "Booking cancelled." });
      }
      await refetchPackages();
    } catch (err) {
      const code = errCode(err);
      if (code === "session_already_started") {
        setBanner({
          tone: "error",
          text: "This class has already started — it can no longer be cancelled.",
        });
        await reload();
      } else if (code === "cancellation_window_passed") {
        setBanner({
          tone: "error",
          text: `Classes can't be cancelled within ${CLASS_CANCELLATION_HOURS} hours of the start time.`,
        });
        await reload();
      } else if (code === "not_cancellable") {
        setBanner({ tone: "error", text: "This booking can no longer be cancelled." });
        await reload();
      } else {
        setBanner({ tone: "error", text: "Couldn't cancel this booking. Please try again." });
      }
    } finally {
      setCancelling(false);
      setCancelTarget(null);
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
  const hasAny = upcoming.length > 0 || past.length > 0;

  return (
    <div>
      <SectionHeading eyebrow="Classes" title="Your classes" />
      <AccountMobileNav />

      {banner && (
        <div
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
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl bg-paper border border-ink/10 p-8 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load your classes.</p>
          <button
            onClick={reload}
            className="mt-4 rounded-full border border-ink/10 px-5 py-2 text-sm font-medium hover:border-accent transition-colors"
          >
            Try again
          </button>
        </div>
      ) : !hasAny ? (
        <EmptyState
          icon={CalendarX}
          title="No classes yet"
          description="Browse classes to book your next session."
          cta={{ href: "/classes", label: "Browse classes" }}
        />
      ) : (
        <>
          <div className="mb-4 -mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
            <div className="inline-flex rounded-lg border border-border bg-warm p-1 mx-4 sm:mx-0">
              {(["upcoming", "ongoing", "past"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
                    tab === t ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
                  )}
                >
                  {TAB_LABEL[t]}
                  <span className="ml-1.5 text-xs text-muted">({counts[t]})</span>
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl bg-paper border border-ink/10 p-8 text-center text-sm text-muted">
              {tab === "upcoming"
                ? "Nothing on the schedule."
                : tab === "ongoing"
                  ? "No classes in progress right now."
                  : "No past classes yet."}
            </div>
          ) : tab === "past" ? (
            <div className="rounded-2xl bg-paper border border-ink/10 divide-y divide-ink/5">
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
                  onCancel={setCancelTarget}
                />
              ))}
            </div>
          )}
        </>
      )}

      {cancelTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4"
          onClick={() => !cancelling && setCancelTarget(null)}
        >
          <div
            className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-paper border border-ink/10 p-6 shadow-hover"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-ink">Cancel this booking?</h3>
            <p className="mt-1 text-sm text-muted">
              {cancelTarget.name} · {formatDate(cancelTarget.starts_at)} ·{" "}
              {formatClassTime(cancelTarget.starts_at)}
            </p>
            <div className="mt-4 rounded-xl border border-ink/10 bg-warm p-3 text-sm text-ink">
              {cancelTarget.was_unlimited
                ? "This frees your spot — your unlimited membership is unaffected."
                : `Your credit will be returned. Classes can only be cancelled at least ${CLASS_CANCELLATION_HOURS} hours before they start.`}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
                className="flex-1 min-h-[44px] rounded-full border border-ink/10 px-4 text-sm font-medium hover:border-accent transition-colors disabled:opacity-60"
              >
                Keep booking
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelling}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-error px-4 text-sm font-medium text-paper hover:bg-error/90 transition-colors disabled:opacity-70 disabled:cursor-wait"
              >
                {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
                {cancelling ? "Cancelling…" : "Confirm cancellation"}
              </button>
            </div>
          </div>
        </div>
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
  onCancel,
}: {
  booking: ApiBooking;
  featured: boolean;
  ongoing?: boolean;
  onCancel: (b: ApiBooking) => void;
}) {
  return (
    <div
      className={cn(
        ongoing
          ? "rounded-2xl bg-paper border border-sage/40 p-6 shadow-soft"
          : featured
            ? "rounded-2xl bg-paper border border-accent/30 p-6 shadow-soft"
            : "rounded-2xl bg-paper border border-ink/10 p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          {ongoing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sage">
              <span className="h-1.5 w-1.5 rounded-full bg-sage animate-pulse" />
              In progress
            </span>
          )}
          <p
            className={cn(
              featured || ongoing
                ? "text-base sm:text-lg font-semibold text-ink truncate"
                : "font-medium text-ink truncate",
              ongoing && "mt-1",
            )}
          >
            {booking.name}
          </p>
          <MetaLine booking={booking} />
          <div className="mt-1 text-xs text-muted sm:hidden">
            {formatDate(booking.starts_at)} · {formatClassTime(booking.starts_at)}
          </div>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="text-sm text-ink font-medium">{formatDate(booking.starts_at)}</p>
          <p className="text-sm text-muted">{formatClassTime(booking.starts_at)}</p>
        </div>
        <QrBadge
          value={booking.qr_token}
          label={booking.name}
          subLabel={`${formatDate(booking.starts_at)} · ${booking.code}`}
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        {canCancel(booking.starts_at) ? (
          <button
            onClick={() => onCancel(booking)}
            className="inline-flex items-center gap-1.5 min-h-[32px] text-xs font-medium text-muted hover:text-error transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        ) : (
          <span className="text-xs text-muted">
            Cancellation closed · within {CLASS_CANCELLATION_HOURS}h of start
          </span>
        )}
      </div>
    </div>
  );
}

function PastRow({ booking }: { booking: ApiBooking }) {
  const attended = booking.check_in_state === "attended";
  const noShow = booking.check_in_state === "no_show" || booking.state === "no_show";
  return (
    <div className="flex items-center justify-between gap-3 sm:gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink truncate">{booking.name}</p>
        {booking.instructor && (
          <p className="text-sm text-muted truncate">with {booking.instructor.name}</p>
        )}
        <p className="text-xs text-muted mt-0.5 sm:hidden">
          {formatDate(booking.starts_at)} · {formatClassTime(booking.starts_at)}
        </p>
      </div>
      <div className="hidden sm:block text-right shrink-0">
        <p className="text-sm text-ink">{formatDate(booking.starts_at)}</p>
        <p className="text-sm text-muted">{formatClassTime(booking.starts_at)}</p>
      </div>
      {attended ? (
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
