"use client";

/**
 * Live "My Workshops" — reads the member's own workshop bookings from the BE
 * (`GET /me/workshop-bookings`). Read-only: workshop cancellations/refunds are
 * arranged with the studio, not self-served in-app.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CalendarX,
  CheckCircle2,
  XCircle,
  Loader2,
  MapPin,
} from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, cn } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { useApi } from "@/lib/api";

export interface ApiWorkshopBooking {
  id: string;
  workshop_id: string;
  workshop_name: string;
  tier_id: string | null;
  tier_name: string | null;
  state: string;
  check_in_state: "pending" | "attended" | "no_show" | "n_a";
  booked_at: string;
  cancelled_at: string | null;
  code: string;
  qr_token: string;
  location: { id: string; name: string; address: string | null } | null;
  starts_at: string | null;
  ends_at: string | null;
}

type Tab = "upcoming" | "past" | "cancelled";

const TAB_LABEL: Record<Tab, string> = {
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled",
};

function classify(b: ApiWorkshopBooking, now: number): Tab {
  if (b.state === "cancelled") return "cancelled";
  if (b.ends_at && new Date(b.ends_at).getTime() <= now) return "past";
  return "upcoming";
}

export function WorkshopBookings() {
  const api = useApi();
  const [rows, setRows] = useState<ApiWorkshopBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("upcoming");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<{ workshop_bookings: ApiWorkshopBooking[] }>(
        "/me/workshop-bookings",
      );
      setRows(res.workshop_bookings ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  const now = Date.now();
  const byTab: Record<Tab, ApiWorkshopBooking[]> = {
    upcoming: [],
    past: [],
    cancelled: [],
  };
  for (const b of rows) byTab[classify(b, now)].push(b);
  byTab.upcoming.sort(
    (a, b) =>
      new Date(a.starts_at ?? a.booked_at).getTime() -
      new Date(b.starts_at ?? b.booked_at).getTime(),
  );
  byTab.past.sort(
    (a, b) =>
      new Date(b.starts_at ?? b.booked_at).getTime() -
      new Date(a.starts_at ?? a.booked_at).getTime(),
  );
  const visible = byTab[tab];
  const hasAny = rows.length > 0;

  return (
    <div>
      <SectionHeading eyebrow="Workshops" title="Your workshops" />
      <AccountMobileNav />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl bg-paper border border-ink/10 p-8 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load your workshops.</p>
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
          title="No workshops yet"
          description="Explore upcoming workshops and immersions."
          cta={{ href: "/workshops", label: "Browse workshops" }}
        />
      ) : (
        <>
          <div className="mb-4 -mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
            <div className="inline-flex rounded-lg border border-border bg-warm p-1 mx-4 sm:mx-0">
              {(["upcoming", "past", "cancelled"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
                    tab === t ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink",
                  )}
                >
                  {TAB_LABEL[t]}
                  <span className="ml-1.5 text-xs text-muted">({byTab[t].length})</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl bg-paper border border-ink/10 p-8 text-center text-sm text-muted">
              {tab === "upcoming"
                ? "Nothing on the schedule."
                : tab === "past"
                  ? "No past workshops yet."
                  : "No cancelled bookings."}
            </div>
          ) : tab === "upcoming" ? (
            <div className="space-y-3">
              {visible.map((b, i) => (
                <UpcomingCard key={b.id} booking={b} featured={i === 0} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-paper border border-ink/10 divide-y divide-ink/5">
              {visible.map((b) => (
                <PastRow key={b.id} booking={b} cancelled={tab === "cancelled"} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function dateLine(b: ApiWorkshopBooking): string {
  if (!b.starts_at) return "Dates to be announced";
  const start = formatDate(b.starts_at);
  const time = formatClassTime(b.starts_at);
  if (b.ends_at) {
    const sameDay = formatDate(b.starts_at) === formatDate(b.ends_at);
    if (!sameDay) return `${start} – ${formatDate(b.ends_at)}`;
  }
  return `${start} · ${time}`;
}

function UpcomingCard({
  booking,
  featured,
}: {
  booking: ApiWorkshopBooking;
  featured: boolean;
}) {
  return (
    <div
      className={cn(
        featured
          ? "rounded-2xl bg-paper border border-accent/30 p-6 shadow-soft"
          : "rounded-2xl bg-paper border border-ink/10 p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <span className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-sage/15 text-sage">
            Workshop
          </span>
          <p
            className={cn(
              featured
                ? "text-base sm:text-lg font-semibold text-ink truncate"
                : "font-medium text-ink truncate",
              "mt-1",
            )}
          >
            {booking.workshop_name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {booking.tier_name && <span>{booking.tier_name}</span>}
            {booking.location && (
              <>
                {booking.tier_name && (
                  <span aria-hidden className="text-ink/20">·</span>
                )}
                <span className="inline-flex items-center gap-1 min-w-0">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" />
                  <span className="truncate">{booking.location.name}</span>
                </span>
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-muted sm:hidden">{dateLine(booking)}</div>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="text-sm text-ink font-medium">{dateLine(booking)}</p>
        </div>
        <QrBadge
          value={booking.qr_token}
          label={booking.workshop_name}
          subLabel={`${dateLine(booking)} · ${booking.code}`}
        />
      </div>
    </div>
  );
}

function PastRow({
  booking,
  cancelled,
}: {
  booking: ApiWorkshopBooking;
  cancelled: boolean;
}) {
  const attended = booking.check_in_state === "attended";
  const noShow = booking.check_in_state === "no_show";
  return (
    <div className="flex items-center justify-between gap-3 sm:gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink truncate">{booking.workshop_name}</p>
        {booking.tier_name && (
          <p className="text-sm text-muted truncate">{booking.tier_name}</p>
        )}
        <p className="text-xs text-muted mt-0.5 sm:hidden">{dateLine(booking)}</p>
      </div>
      <div className="hidden sm:block text-right shrink-0">
        <p className="text-sm text-ink">{dateLine(booking)}</p>
      </div>
      {cancelled ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warm px-2.5 py-1 text-xs font-medium text-muted">
          <XCircle className="w-3.5 h-3.5" />
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
