"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarDays, GraduationCap, MapPin } from "lucide-react";
import { BookingSurface, FLUSH_BLEED } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [selectedLocation, setSelectedLocation] = useState<string | "all">(
    "all",
  );

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
    <div id="list">
      <BookingSurface maxWidth="xl" flush>
        <SectionHeading eyebrow="Upcoming" title="Scheduled workshops" />

        {/* One studio has nothing to choose between. */}
        {locations.length > 1 && (
          <div className="mb-6">
            <ApiLocationFilter
              locations={locations}
              selected={selectedLocation}
              onChange={setSelectedLocation}
            />
          </div>
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
          <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
            We couldn&apos;t load workshops right now. Please refresh in a moment.
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink/15 px-6 py-14 text-center">
            <GraduationCap className="mx-auto h-6 w-6 text-muted" aria-hidden />
            <p className="mt-3 text-sm font-medium text-ink">
              {selectedLocation === "all"
                ? "No upcoming workshops at the moment"
                : "No workshops scheduled at this location"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {selectedLocation === "all"
                ? "New workshops are listed here as soon as they open. Check back soon."
                : "Try another studio."}
            </p>
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
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function ApiLocationFilter({
  locations,
  selected,
  onChange,
}: {
  locations: ApiLocationLite[];
  selected: string | "all";
  onChange: (id: string | "all") => void;
}) {
  const options = [{ id: "all", name: "All locations" }, ...locations];
  // Studio names are the studio's own and can be long, so the chips scroll
  // sideways on a phone rather than pushing the page wider.
  return (
    <div className={cn("overflow-x-auto no-scrollbar", FLUSH_BLEED)}>
      <div className="flex w-max gap-2" role="group" aria-label="Filter by location">
        {options.map((loc) => {
          const active = selected === loc.id;
          return (
            <button
              key={loc.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(loc.id)}
              className={cn(
                "min-h-[40px] whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/10 bg-card text-muted hover:text-ink hover:border-ink/20",
              )}
            >
              {loc.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const priceLabel =
    workshop.min_price_sgd != null
      ? workshop.tiers_count > 1
        ? `From ${formatSgd(workshop.min_price_sgd)}`
        : formatSgd(workshop.min_price_sgd)
      : "Price TBA";
  const shape =
    workshop.days_count > 1
      ? `${workshop.days_count} sessions`
      : "Single session";

  const body = (
    <>
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-warm">
        {workshop.cover_url ? (
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
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <GraduationCap className="h-8 w-8 text-ink/20" aria-hidden />
          </div>
        )}
        {isPast && (
          <span className="absolute left-3 top-3 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-muted">
            Ended
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-accent-deep">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {dateRange}
        </p>
        <h3 className="mt-1.5 font-serif text-lg leading-snug text-ink">
          {workshop.name}
        </h3>
        {workshop.location && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-ink/30" aria-hidden />
            <span className="truncate">{workshop.location.name}</span>
          </p>
        )}
        {summary && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">
            {summary}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="min-w-0">
            <p className="text-base font-bold text-ink">{priceLabel}</p>
            <p className="text-xs text-muted">
              {shape}
              {workshop.tiers_count > 1 ? ` · ${workshop.tiers_count} options` : ""}
            </p>
          </div>
          {!isPast && (
            <span className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-white transition-colors group-hover:bg-accent-deep">
              View &amp; book
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          )}
        </div>
      </div>
    </>
  );

  const card =
    "group flex w-full flex-col overflow-hidden rounded-2xl border border-ink/5 bg-card shadow-soft";

  // A workshop that has ended has nothing to book, so it isn't a link.
  if (isPast) {
    return <div className={cn(card, "opacity-75")}>{body}</div>;
  }
  return (
    <Link
      href={`/workshops/${workshop.id}`}
      className={cn(card, "transition-shadow md:hover:shadow-hover")}
    >
      {body}
    </Link>
  );
}
