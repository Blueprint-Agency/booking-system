"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, GraduationCap, MapPin } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { PageHeader } from "@/components/booking/page-header";
import { DateStub } from "@/components/account/date-stub";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips } from "@/components/ui/filter-chips";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import {
  type ApiLocationLite,
  type ApiWorkshopCard,
  formatDayRange,
  formatSgd,
  useWorkshops,
} from "@/lib/workshops";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkshopsPage() {
  const { data, loading, error } = useWorkshops();
  const [selectedLocation, setSelectedLocation] = useState<string>("all");

  const workshops = useMemo(() => data ?? [], [data]);

  const locations: ApiLocationLite[] = useMemo(() => {
    const map = new Map<string, ApiLocationLite>();
    for (const w of workshops) {
      if (w.location) map.set(w.location.id, w.location);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [workshops]);

  const filtered = useMemo(() => {
    if (selectedLocation === "all") return workshops;
    return workshops.filter((w) => w.location?.id === selectedLocation);
  }, [workshops, selectedLocation]);

  return (
    <BookingSurface>
      <PageHeader title="Workshops" />

      {/* One studio has nothing to choose between. */}
      {locations.length > 1 && (
        <FilterChips
          label="Filter by location"
          className="mb-5"
          options={[
            { value: "all", label: "All locations" },
            ...locations.map((l) => ({ value: l.id, label: l.name })),
          ]}
          value={selectedLocation}
          onChange={setSelectedLocation}
        />
      )}

      {loading && (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label="Loading workshops"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className={cn(CARD, "p-8 text-center text-sm text-muted")}>
          Couldn&apos;t load workshops. Refresh to try again.
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={CARD}>
          <EmptyState
            icon={GraduationCap}
            title={selectedLocation === "all" ? "No workshops scheduled" : "No workshops here"}
            description={
              selectedLocation === "all"
                ? "New workshops show up here when they open."
                : "Try another location."
            }
          />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((workshop) => (
            <li key={workshop.id} className="flex">
              <WorkshopCard workshop={workshop} />
            </li>
          ))}
        </ul>
      )}
    </BookingSurface>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function firstLine(text: string | null): string {
  if (!text) return "";
  // BE returns HTML; strip tags to get a one-liner summary.
  const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const line = stripped.split(/[\.!?]/).find(Boolean) ?? stripped;
  return line.length > 160 ? line.slice(0, 157).trimEnd() + "…" : line;
}

function WorkshopCard({ workshop }: { workshop: ApiWorkshopCard }) {
  const now = Date.now();
  const endsAt = workshop.ends_at ? new Date(workshop.ends_at) : null;
  const isPast = endsAt ? endsAt.getTime() < now : false;

  const summary = firstLine(workshop.description_html);
  const dateRange = formatDayRange(workshop.starts_at, workshop.ends_at);
  const minPrice = workshop.min_price_sgd;
  const priceLabel =
    minPrice == null
      ? "Price TBA"
      : Number(minPrice) <= 0 && workshop.tiers_count <= 1
        ? "Free"
        : workshop.tiers_count > 1
          ? `From ${formatSgd(minPrice)}`
          : formatSgd(minPrice);
  const shape =
    workshop.days_count > 1 ? `${workshop.days_count} sessions` : "1 session";

  // The same date stub a booking carries in the account area: over the cover
  // when there is one, beside the title when there isn't — an empty picture
  // frame is a screenful of nothing on a phone.
  const stub = (className?: string) => (
    <DateStub iso={workshop.starts_at} tone={isPast ? "muted" : "default"} className={className} />
  );
  const ended = isPast && (
    <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-xs font-semibold text-muted">
      Ended
    </span>
  );

  const body = (
    <>
      {workshop.cover_url && (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-warm">
          <Image
            src={workshop.cover_url}
            alt=""
            fill
            sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw"
            className={cn(
              "object-cover transition-transform duration-500 md:group-hover:scale-[1.03]",
              isPast && "grayscale",
            )}
          />
          {stub("absolute left-3 top-3 bg-card/95 shadow-soft backdrop-blur-sm")}
        </div>
      )}

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {!workshop.cover_url && stub()}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold leading-snug text-ink">{workshop.name}</h2>
              {ended}
            </div>
            <p className="mt-0.5 text-sm text-muted">{dateRange}</p>
            {workshop.location && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" aria-hidden />
                <span className="truncate">{workshop.location.name}</span>
              </p>
            )}
          </div>
        </div>
        {summary && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink/70">{summary}</p>
        )}

        <div className="mt-auto pt-4" />
        <div className="flex items-center justify-between gap-3 border-t border-ink/5 pt-3">
          <p className="min-w-0 text-sm">
            <span className="font-bold text-ink">{priceLabel}</span>
            <span className="text-muted">
              {" · "}
              {shape}
            </span>
          </p>
          {!isPast && (
            <ChevronRight
              className="h-5 w-5 shrink-0 text-ink/30 transition-colors group-hover:text-ink"
              aria-hidden
            />
          )}
        </div>
      </div>
    </>
  );

  const card = cn(CARD, "group flex w-full flex-col overflow-hidden");

  // A workshop that has ended has nothing to book, so it isn't a link.
  if (isPast) {
    return <div className={cn(card, "opacity-75")}>{body}</div>;
  }
  return (
    <Link href={`/workshops/${workshop.id}`} className={cn(card, "transition-shadow md:hover:shadow-hover")}>
      {body}
    </Link>
  );
}
