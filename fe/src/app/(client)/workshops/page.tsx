"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { LocationFilter } from "@/components/location-filter";
import { cn } from "@/lib/utils";
import type { Session, Location } from "@/types";
import sessionsData from "@/data/sessions.json";
import locationsData from "@/data/locations.json";

const typedSessions = sessionsData as Session[];
const typedLocations = locationsData as Location[];
const TENANT_LOCATIONS = typedLocations.filter((l) => l.tenantId === "tenant-1");

const WORKSHOPS = typedSessions
  .filter((s) => s.tenantId === "tenant-1" && (s.type === "workshop" || s.type === "event"))
  .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

const TODAY = new Date("2026-04-03");

function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 160 ? line.slice(0, 157).trimEnd() + "…" : line;
}

function WorkshopRow({ workshop }: { workshop: Session }) {
  const [open, setOpen] = useState(false);
  const sessionDate = new Date(workshop.date + "T00:00:00");
  const isPast = sessionDate < TODAY;
  const isFull = workshop.bookedCount >= workshop.capacity;
  const disabled = isPast || isFull;

  const packages =
    workshop.workshopPackages && workshop.workshopPackages.length > 0
      ? workshop.workshopPackages
      : [{ name: workshop.name, description: "1 Class", price: workshop.price }];

  const summary =
    packages.length > 1
      ? "Single session, Class Pack, or Unlimited options"
      : firstLine(workshop.description);

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
          <p className="text-sm text-muted leading-relaxed mt-1">
            {summary}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {open ? "Hide" : "View"}
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <ul className="pb-6 md:px-6">
          {packages.map((pkg, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-4 md:gap-6 py-3 md:py-4 border-t border-ink/5"
            >
              <div className="min-w-0">
                <p className="font-serif text-[15px] text-ink leading-snug">{pkg.name}</p>
                <p className="text-xs text-muted mt-0.5">
                  {pkg.description || "1 Class"}
                </p>
              </div>
              <span className="text-sm font-semibold text-ink text-right whitespace-nowrap tracking-tight">
                ${pkg.price.toFixed(2)}
              </span>
              {disabled ? (
                <span className="inline-flex items-center justify-center rounded-full bg-warm text-muted border border-border px-5 py-2 text-xs cursor-not-allowed">
                  {isPast ? "Ended" : "Full"}
                </span>
              ) : (
                <Link
                  href={`/workshops/${workshop.id}?pkg=${i}`}
                  className="inline-flex items-center justify-center rounded-full bg-accent text-white px-5 py-2 text-xs font-medium hover:bg-accent-deep transition-colors"
                >
                  Book Now
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WorkshopsPage() {
  const [selectedLocation, setSelectedLocation] = useState<string | "all">("all");

  const filteredWorkshops =
    selectedLocation === "all"
      ? WORKSHOPS
      : WORKSHOPS.filter((w) => w.locationId === selectedLocation);

  return (
    <div id="list">
      <BookingSurface maxWidth="xl" padding="default">
        <SectionHeading eyebrow="Upcoming" title="Scheduled workshops" />

        <div className="mb-8">
          <LocationFilter
            locations={TENANT_LOCATIONS}
            selected={selectedLocation}
            onChange={setSelectedLocation}
          />
        </div>

        {filteredWorkshops.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted">
              {selectedLocation === "all"
                ? "No upcoming workshops at the moment. Check back soon."
                : "No workshops scheduled at this location. Try another studio."}
            </p>
          </div>
        ) : (
          <div className="border-t border-ink/10">
            {filteredWorkshops.map((workshop) => (
              <WorkshopRow key={workshop.id} workshop={workshop} />
            ))}
          </div>
        )}
      </BookingSurface>
    </div>
  );
}
