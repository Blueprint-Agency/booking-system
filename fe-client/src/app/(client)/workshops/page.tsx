"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
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

  const workshops = data ?? [];

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
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading eyebrow="Upcoming" title="Scheduled workshops" />

        {locations.length > 0 && (
          <div className="mb-8">
            <ApiLocationFilter
              locations={locations}
              selected={selectedLocation}
              onChange={setSelectedLocation}
            />
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading workshops…
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning/10 text-ink text-sm px-4 py-3 text-center">
            We couldn't load workshops right now. Please refresh in a moment.
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-muted">
              {selectedLocation === "all"
                ? "No upcoming workshops at the moment. Check back soon."
                : "No workshops scheduled at this location. Try another studio."}
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="border-t border-ink/10">
            {filtered.map((workshop) => (
              <WorkshopRow key={workshop.id} workshop={workshop} />
            ))}
          </div>
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
  return (
    <div className="inline-flex rounded-lg border border-border bg-warm p-1">
      <button
        onClick={() => onChange("all")}
        className={cn(
          "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
          selected === "all"
            ? "bg-card text-ink shadow-soft"
            : "text-muted hover:text-ink",
        )}
      >
        All Locations
      </button>
      {locations.map((loc) => (
        <button
          key={loc.id}
          onClick={() => onChange(loc.id)}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap",
            selected === loc.id
              ? "bg-card text-ink shadow-soft"
              : "text-muted hover:text-ink",
          )}
        >
          {loc.name}
        </button>
      ))}
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

function WorkshopRow({ workshop }: { workshop: ApiWorkshopCard }) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const startsAt = workshop.starts_at ? new Date(workshop.starts_at) : null;
  const endsAt = workshop.ends_at ? new Date(workshop.ends_at) : null;
  const isPast = endsAt ? endsAt.getTime() < now : false;

  const summary = firstLine(workshop.description_html);
  const dateRange = formatDayRange(workshop.starts_at, workshop.ends_at);
  const priceLabel =
    workshop.min_price_sgd != null
      ? workshop.tiers_count > 1
        ? `From ${formatSgd(workshop.min_price_sgd)}`
        : formatSgd(workshop.min_price_sgd)
      : "TBA";

  return (
    <div className="border-b border-ink/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-[1fr_auto] items-center gap-4 md:gap-6 px-2 md:px-6 py-6 text-left hover:bg-ink/[0.02] transition-colors"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <h3 className="font-serif text-lg md:text-xl text-ink leading-snug">
            {workshop.name}
          </h3>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            {dateRange}
            {workshop.location ? ` · ${workshop.location.name}` : ""}
          </p>
          {summary && (
            <p className="text-sm text-muted leading-relaxed mt-1.5 line-clamp-2">
              {summary}
            </p>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
          <span className="font-semibold text-ink">{priceLabel}</span>
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <div className="pb-6 md:px-6">
          <div className="grid grid-cols-[1fr_auto] gap-3 py-3 border-t border-ink/5 items-center">
            <p className="text-sm text-muted">
              {workshop.tiers_count > 1
                ? "Multiple pricing tiers available — view details to choose."
                : workshop.days_count > 1
                  ? `${workshop.days_count} sessions across multiple days.`
                  : "Single-session workshop."}
            </p>
            {isPast ? (
              <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-5 py-2 text-xs cursor-not-allowed">
                Ended
              </span>
            ) : (
              <Link
                href={`/workshops/${workshop.id}`}
                className="inline-flex items-center justify-center rounded-full bg-accent text-white px-5 py-2 text-xs font-medium hover:bg-accent-deep transition-colors"
              >
                View & Book
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
