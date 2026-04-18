"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CtaBanner } from "@/components/marketing/cta-banner";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { Info, UserX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";
import type { Instructor, Location } from "@/types";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

// Suppress unused-import lint — MOCK_USER preserved per spec
void MOCK_USER;

/** Derive a short specialty label from the bio's leading style mention. */
function specialtyLabel(bio: string): string {
  const match = bio.match(/^([^.]+)/);
  if (!match) return "Instructor";
  // Take up to the first comma or "with" — whichever comes first
  const clause = match[1].replace(/\s+with\s.*$/, "").replace(/,.*$/, "").trim();
  return clause;
}

export default function PrivateSessionsPage() {
  const router = useRouter();

  const [selectedInstructor, setSelectedInstructor] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  function handleFindAvailability() {
    if (!selectedInstructor) return;
    const params = new URLSearchParams();
    if (selectedLocation) params.set("location", selectedLocation);
    if (selectedDate) params.set("date", selectedDate);
    const qs = params.toString();
    router.push(`/private-sessions/${selectedInstructor}${qs ? `?${qs}` : ""}`);
  }

  return (
    <>
<div id="form">
        <BookingSurface maxWidth="lg" padding="default">
          <SectionHeading eyebrow="Step 1 of 2" title="Who and where" />

          {/* How private sessions work */}
          <div className="mb-8 rounded-2xl border border-border bg-warm p-5 flex gap-4">
            <Info size={18} className="text-accent shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-ink">
                How private sessions work
              </p>
              <ul className="text-xs text-muted leading-relaxed space-y-1 list-disc pl-4">
                <li>Submit a session request — no upfront payment needed.</li>
                <li>We confirm availability and details within <span className="font-medium text-ink">12 hours</span>.</li>
                <li>Once confirmed, your PT package is activated.</li>
                <li>
                  Sessions use PT credits (1 credit = 30 mins) — separate from
                  group class credits.
                </li>
                <li>
                  You can hold multiple PT packages; credits are auto-deducted
                  from the soonest-expiring one.
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-8">
            {/* Instructor picker */}
            <div>
              <span className="text-xs uppercase tracking-wider text-muted mb-2 block">
                Instructor
              </span>
              {typedInstructors.length === 0 ? (
                <EmptyState
                  icon={UserX}
                  title="No instructors available"
                  description="Please check back soon — we're updating our instructor roster."
                />
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {typedInstructors.map((instructor) => (
                  <button
                    key={instructor.id}
                    type="button"
                    onClick={() => setSelectedInstructor(instructor.id)}
                    disabled={!instructor.available}
                    className={cn(
                      "rounded-2xl border border-ink/10 p-4 hover:border-accent cursor-pointer transition-colors text-left",
                      selectedInstructor === instructor.id && "border-accent bg-accent/5",
                      !instructor.available && "opacity-40 cursor-not-allowed hover:border-ink/10"
                    )}
                  >
                    <p className="text-sm font-medium text-ink leading-snug">
                      {instructor.name}
                      {!instructor.available && (
                        <span className="ml-2 text-[10px] font-normal text-muted">(unavailable)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted leading-snug mt-0.5">
                      {specialtyLabel(instructor.bio)}
                    </p>
                    {instructor.locationIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {instructor.locationIds.map((locId) => {
                          const loc = typedLocations.find((l) => l.id === locId);
                          if (!loc) return null;
                          return (
                            <span
                              key={locId}
                              className="inline-flex items-center rounded-full bg-warm text-muted px-2 py-0.5 text-[10px] font-medium"
                            >
                              {loc.shortName}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
              )}
            </div>

            {/* Location picker */}
            <div>
              <span className="text-xs uppercase tracking-wider text-muted mb-2 block">
                Location
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {typedLocations.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => setSelectedLocation(location.id)}
                    className={cn(
                      "rounded-2xl border border-ink/10 p-4 hover:border-accent cursor-pointer transition-colors text-left",
                      selectedLocation === location.id && "border-accent bg-accent/5"
                    )}
                  >
                    <p className="text-sm font-medium text-ink">{location.name}</p>
                    <p className="text-xs text-muted mt-0.5">{location.address}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Date picker */}
            <div>
              <span className="text-xs uppercase tracking-wider text-muted mb-2 block">
                Preferred date
              </span>
              <div className="rounded-2xl border border-ink/10 p-4">
                <input
                  type="date"
                  value={selectedDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-transparent text-sm text-ink focus:outline-none cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-10 pt-6 border-t border-ink/10 flex justify-end">
            <button
              type="button"
              onClick={handleFindAvailability}
              disabled={!selectedInstructor}
              className="rounded-full bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50"
            >
              Find availability
            </button>
          </div>
        </BookingSurface>
      </div>

      <CtaBanner
        imageKey="cta-community"
        headline="Prefer group classes?"
        subheadline="See this week's schedule."
        primaryCta={{ href: "/classes", label: "View classes" }}
      />
    </>
  );
}
