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
  MapPin,
} from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { AccountPageHeader } from "@/components/account/account-page-header";
import { SegmentedTabs } from "@/components/account/segmented-tabs";
import { DateStub } from "@/components/account/date-stub";
import { EmptyState } from "@/components/ui/empty-state";
import { ContentLoading } from "@/components/ui/content-loading";
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
      {/* There is no self-serve cancel for a workshop, and a cancelled one is
          not the same as a refunded one — the studio arranges both (#272). */}
      <AccountPageHeader
        title="Your workshops"
        description="Workshop bookings can't be cancelled in the app. To change or cancel one, or to ask about a refund, contact the studio."
      />

      {loading ? (
        <ContentLoading label="Loading your workshops" />
      ) : loadError ? (
        <div className="rounded-2xl bg-card border border-ink/5 shadow-soft p-8 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load your workshops.</p>
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
            title="No workshops yet"
            description="Explore upcoming workshops and immersions."
            cta={{ href: "/workshops", label: "Browse workshops" }}
          />
        </div>
      ) : (
        <>
          <SegmentedTabs
            label="Workshops"
            tabs={(["upcoming", "past", "cancelled"] as Tab[]).map((t) => ({ value: t, label: TAB_LABEL[t] }))}
            value={tab}
            onChange={setTab}
            counts={{ upcoming: byTab.upcoming.length, past: byTab.past.length, cancelled: byTab.cancelled.length }}
          />

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 p-8 text-center text-sm text-muted">
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
            <>
              {tab === "cancelled" && (
                <p className="mb-3 text-xs text-muted">
                  A cancelled booking hasn&apos;t necessarily been refunded. Any refund
                  is arranged by the studio and shows on your card statement.
                </p>
              )}
              <div className="rounded-2xl bg-card border border-ink/5 shadow-soft divide-y divide-ink/5">
                {visible.map((b) => (
                  <PastRow key={b.id} booking={b} cancelled={tab === "cancelled"} />
                ))}
              </div>
            </>
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
        "rounded-2xl bg-card border shadow-soft p-4",
        featured ? "border-accent/25" : "border-ink/5",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <DateStub iso={booking.starts_at} tone={featured ? "accent" : "default"} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink break-words leading-snug">
            {booking.workshop_name}
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink/80">{dateLine(booking)}</p>
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
    <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4">
      <DateStub iso={booking.starts_at} tone="muted" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink truncate">{booking.workshop_name}</p>
        <p className="text-sm text-muted truncate">
          {booking.tier_name ? `${booking.tier_name} · ` : ""}
          {dateLine(booking)}
        </p>
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
