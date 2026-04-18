"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { LocationFilter } from "@/components/location-filter";
import { formatDate, formatTime } from "@/lib/utils";
import { img } from "@/data/images";
import type { Session, Instructor, Location } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];
const TENANT_LOCATIONS = typedLocations.filter((l) => l.tenantId === "tenant-1");

// Tenant-1 workshops and events, sorted latest first
const WORKSHOPS = typedSessions
  .filter((s) => s.tenantId === "tenant-1" && (s.type === "workshop" || s.type === "event"))
  .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

const TODAY = new Date("2026-04-03");

function getInstructor(id: string): Instructor | undefined {
  return typedInstructors.find((i) => i.id === id);
}

const LEVEL_STYLES: Record<Session["level"], { label: string; cls: string }> = {
  beginner: { label: "Beginner", cls: "bg-sage/15 text-sage border-sage/25" },
  intermediate: { label: "Intermediate", cls: "bg-warning/15 text-warning border-warning/30" },
  advanced: { label: "Advanced", cls: "bg-error/15 text-error border-error/30" },
  all: { label: "All levels", cls: "bg-accent/10 text-accent-deep border-accent/25" },
};

function WorkshopCard({ workshop }: { workshop: Session }) {
  const instructor = getInstructor(workshop.instructorId);
  const instructorName = instructor?.name ?? "Instructor";
  const sessionDate = new Date(workshop.date + "T00:00:00");
  const isPast = sessionDate < TODAY;
  const isFull = workshop.bookedCount >= workshop.capacity;
  const isFree = workshop.price === 0;
  const seatsLeft = workshop.capacity - workshop.bookedCount;

  const priceLabel = isFree
    ? "Free"
    : workshop.workshopPackages && workshop.workshopPackages.length > 1
      ? `From S$${Math.min(...workshop.workshopPackages.map((p) => p.price))}`
      : `S$${workshop.price}`;

  const statusLabel = isPast
    ? "Workshop Ended"
    : isFull
      ? "Fully Enrolled"
      : null;

  const level = LEVEL_STYLES[workshop.level];
  const canWaitlist = !isPast && isFull && workshop.waitlistEnabled;

  // CTA copy — Register for free, Purchase for paid
  const ctaLabel = isPast
    ? "View details"
    : isFull
      ? canWaitlist
        ? "Join waitlist →"
        : "View details"
      : isFree
        ? "Register →"
        : "Purchase →";

  const cardImage = img("cat-workshop");

  return (
    <Link
      href={`/workshops/${workshop.id}`}
      className="rounded-2xl overflow-hidden border border-ink/10 bg-paper hover:shadow-hover transition-shadow group block flex flex-col"
    >
      {/* Photo */}
      <div className="photo-warm aspect-[4/3] relative overflow-hidden">
        <Image
          src={cardImage.unsplash}
          alt={cardImage.alt}
          fill
          className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
        />
        {statusLabel && (
          <div className="absolute top-3 left-3">
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-ink/60 text-paper">
              {statusLabel}
            </span>
          </div>
        )}
        {workshop.type === "event" && (
          <div className="absolute top-3 right-3">
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-accent text-paper">
              Event
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col flex-1">
        {/* Level + seats row */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${level.cls}`}>
            {level.label}
          </span>
          {!isPast && !isFull && (
            <span className="text-[11px] text-muted">
              {seatsLeft} of {workshop.capacity} spots left
            </span>
          )}
        </div>

        <h3 className="text-xl font-bold text-ink leading-snug">{workshop.name}</h3>
        <p className="text-sm text-muted mt-1">
          {instructorName} · {formatDate(workshop.date)} · {formatTime(workshop.time)}
        </p>

        {/* Pricing tiers list (if multiple) */}
        {!isFree && workshop.workshopPackages && workshop.workshopPackages.length > 1 && (
          <ul className="mt-3 space-y-0.5">
            {workshop.workshopPackages.map((tier, i) => (
              <li key={i} className="flex justify-between text-xs text-muted">
                <span>{tier.name}</span>
                <span className="font-medium text-ink">S${tier.price}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Payment note */}
        {!isFree && (
          <p className="text-[11px] text-muted/80 mt-3 leading-snug">
            Direct payment only — credits cannot be used.
          </p>
        )}

        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="text-base font-semibold text-ink">{priceLabel}</span>
          <span className="text-sm font-medium text-accent group-hover:text-accent-deep transition-colors">
            {ctaLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function WorkshopsPage() {
  const [selectedLocation, setSelectedLocation] = useState<string | "all">("all");

  const filteredWorkshops =
    selectedLocation === "all"
      ? WORKSHOPS
      : WORKSHOPS.filter((w) => w.locationId === selectedLocation);

  return (
    <>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWorkshops.map((workshop) => (
                <WorkshopCard key={workshop.id} workshop={workshop} />
              ))}
            </div>
          )}
        </BookingSurface>
      </div>
    </>
  );
}
