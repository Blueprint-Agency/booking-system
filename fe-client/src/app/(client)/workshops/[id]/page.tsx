"use client";

import { useParams } from "next/navigation";
import Image from "next/image";
import { Calendar, MapPin, CalendarX } from "lucide-react";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { GatedLink } from "@/components/auth/auth-gate";
import { formatDate } from "@/lib/utils";
import type { Session, Instructor, Location } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedSessions = sessionsData as Session[];
const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

export default function WorkshopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = typedSessions.find((s) => s.id === id);
  const instructor = typedInstructors.find((i) => i?.id === session?.instructorId);
  const location = typedLocations.find((l) => l.id === session?.locationId);

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <EmptyState
          icon={CalendarX}
          title="Workshop not found"
          description="This workshop doesn't exist or has been removed."
          cta={{ href: "/workshops", label: "Back to Workshops" }}
        />
      </div>
    );
  }

  const seatsLeft = session.capacity - session.bookedCount;
  const priceLabel =
    session.workshopPackages && session.workshopPackages.length > 1
      ? `From S$${Math.min(...session.workshopPackages.map((p) => p.price))}`
      : `S$${session.price}`;

  return (
    <>
<div id="purchase">
        <BookingSurface maxWidth="lg" padding="default">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
            {/* Left column */}
            <div>
              <SectionHeading eyebrow="About" title="What to expect" />

              <div className="prose text-ink/80 max-w-none space-y-4">
                {session.description
                  .split("\n\n")
                  .filter(Boolean)
                  .map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
              </div>

              {/* Instructor card */}
              {instructor && (
                <div className="flex gap-4 items-start border-t border-ink/10 pt-8 mt-10">
                  {instructor.avatarUrl ? (
                    <div className="relative h-14 w-14 shrink-0 rounded-full overflow-hidden">
                      <Image
                        src={instructor.avatarUrl}
                        alt={instructor.name}
                        fill
                        className="object-cover"
                        sizes="56px"
                      />
                    </div>
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-full bg-ink/10 flex items-center justify-center text-ink font-bold text-lg">
                      {instructor.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-ink">{instructor.name}</p>
                    {instructor.bio && (
                      <p className="text-sm text-ink/70 mt-1 leading-relaxed">{instructor.bio}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Date & Location rows */}
              <div className="mt-4 space-y-2">
                <div className="text-sm text-muted flex items-center gap-2">
                  <Calendar size={15} className="shrink-0" />
                  <span>{formatDate(session.date)}</span>
                </div>
                {location && (
                  <div className="text-sm text-muted flex items-center gap-2">
                    <MapPin size={15} className="shrink-0" />
                    <span>{location.name} · {location.address}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right column — sticky purchase card */}
            <div className="sticky top-24 self-start rounded-2xl border border-ink/10 bg-paper p-6">
              <p className="text-3xl font-extrabold text-ink">{priceLabel}</p>
              <p className="text-xs uppercase tracking-wider text-muted mt-1">
                {seatsLeft > 0 ? `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left` : "Fully booked"}
              </p>
              <GatedLink
                href={`/checkout?session=${session.id}&type=workshop`}
                context="book a workshop"
                className="block rounded-full bg-ink text-paper w-full py-3 text-sm font-medium mt-4 hover:bg-ink/90 transition-colors text-center"
              >
                Purchase Now
              </GatedLink>
              <p className="text-xs text-muted mt-3 text-center">
                You will be redirected to checkout
              </p>
            </div>
          </div>
        </BookingSurface>
      </div>

    </>
  );
}
