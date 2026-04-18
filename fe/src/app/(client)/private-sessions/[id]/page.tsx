"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { UserX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { getLocation } from "@/lib/utils";
import { MOCK_USER } from "@/data/mock-user";
import { PRIVATE_SESSION_CANCELLATION_POLICY } from "@/data/policy";
import type { Instructor, Location } from "@/types";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const typedInstructors = instructorsData as Instructor[];
const typedLocations = locationsData as Location[];

// Mock time slots for the detail page
const MOCK_SLOTS = [
  { id: "slot-1", time: "Mon 21 Apr · 9:00 AM", duration: 60, price: 120 },
  { id: "slot-2", time: "Mon 21 Apr · 11:00 AM", duration: 60, price: 120 },
  { id: "slot-3", time: "Tue 22 Apr · 7:00 AM", duration: 60, price: 120 },
  { id: "slot-4", time: "Tue 22 Apr · 5:00 PM", duration: 60, price: 120 },
  { id: "slot-5", time: "Wed 23 Apr · 9:00 AM", duration: 60, price: 120 },
];

export default function PrivateSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const instructor = typedInstructors.find((i) => i.id === id);
  const [submitted, setSubmitted] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const instructorLocations = instructor?.locationIds
    ? typedLocations.filter((l) => instructor.locationIds.includes(l.id))
    : [];
  const [preferredLocation, setPreferredLocation] = useState(
    instructorLocations[0]?.id ?? ""
  );

  if (!instructor) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <EmptyState
          icon={UserX}
          title="Instructor not found"
          description="This instructor profile doesn't exist or has been removed."
          cta={{ href: "/private-sessions", label: "Back to Private Sessions" }}
        />
      </div>
    );
  }

  const duration = 60;
  const locationName =
    preferredLocation && getLocation(preferredLocation)
      ? getLocation(preferredLocation)!.name
      : instructorLocations.length > 0
        ? instructorLocations[0].name
        : "Choose a location";

  const chosen = MOCK_SLOTS.find((s) => s.id === selectedSlot);

  // Continue handler — mirrors original request flow
  const handleContinue = () => {
    if (!selectedSlot) return;
    setSubmitted(true);
  };

  return (
    <>
      {/* Booking surface */}
      <div id="slots">
        <BookingSurface maxWidth="lg" padding="default">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
            {/* ── Left column ── */}
            <div>
              {/* About */}
              <SectionHeading eyebrow="About" title="Your instructor" />
              <div className="prose text-ink/80 max-w-none space-y-4 -mt-4">
                <p>{instructor.bio}</p>
                {instructorLocations.length > 0 && (
                  <p className="not-prose text-sm text-muted">
                    Available at:{" "}
                    {instructorLocations.map((l) => l.name).join(" · ")}
                  </p>
                )}
                {/* Location picker when multiple */}
                {instructorLocations.length > 1 && (
                  <div className="not-prose mt-4">
                    <p className="text-sm font-medium text-ink mb-2">
                      Preferred location
                    </p>
                    <div className="inline-flex rounded-lg border border-ink/10 bg-warm p-1">
                      {instructorLocations.map((loc) => (
                        <button
                          key={loc.id}
                          onClick={() => setPreferredLocation(loc.id)}
                          className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap ${
                            preferredLocation === loc.id
                              ? "bg-card text-ink shadow-soft"
                              : "text-muted hover:text-ink"
                          }`}
                        >
                          {loc.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Included */}
              <div className="border-t border-ink/10 pt-8 mt-10">
                <SectionHeading eyebrow="Included" title="What you get" />
                <ul className="text-sm text-muted space-y-2 -mt-4 list-none pl-0">
                  {[
                    "60-minute private session with your instructor",
                    "Personalised sequence tailored to your goals",
                    "Post-session notes & home practice suggestions",
                    "Flexible location — studio or online",
                    "Deducted from your PT credit balance",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-0.5 text-accent-deep shrink-0">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Policies */}
              <div className="border-t border-ink/10 pt-8 mt-10">
                <SectionHeading
                  eyebrow="Policies"
                  title="Reschedule & cancellation"
                />
                <p className="text-sm text-muted -mt-4 leading-relaxed">
                  Reschedule or cancel up to {PRIVATE_SESSION_CANCELLATION_POLICY.window} before your session at no
                  charge. Cancellations within {PRIVATE_SESSION_CANCELLATION_POLICY.window} forfeit the session
                  credit. No-shows are non-refundable. To reschedule, visit My
                  Bookings or contact the studio directly.
                </p>
              </div>
            </div>

            {/* ── Right column (sticky) ── */}
            <div className="sticky top-24 self-start rounded-2xl border border-ink/10 bg-paper p-6">
              <p className="text-xs uppercase tracking-wider text-muted mb-4">
                Available times
              </p>

              {/* Slot list */}
              <div className="space-y-2">
                {MOCK_SLOTS.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot.id)}
                    className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between transition-colors w-full text-left ${
                      selectedSlot === slot.id
                        ? "border-accent bg-accent/5"
                        : "border-ink/10 hover:border-accent"
                    }`}
                  >
                    <span className="font-medium text-ink">{slot.time}</span>
                    <span className="text-muted">{slot.duration} min</span>
                  </button>
                ))}
              </div>

              {/* Price + CTA */}
              <div className="mt-6 pt-6 border-t border-ink/10">
                <p className="text-lg font-bold text-ink">
                  {chosen ? `S$${chosen.price}` : "S$120"}{" "}
                  <span className="text-sm font-normal text-muted">
                    / session
                  </span>
                </p>
                <button
                  onClick={handleContinue}
                  disabled={!selectedSlot}
                  className="rounded-full bg-ink text-paper w-full py-3 text-sm font-medium mt-4 hover:bg-ink/90 disabled:opacity-50 transition-colors"
                >
                  Continue to checkout
                </button>
              </div>
            </div>
          </div>
        </BookingSurface>
      </div>

      {/* Success dialog — preserved from original */}
      <AnimatePresence>
        {submitted && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="bg-card rounded-2xl p-8 max-w-sm w-full shadow-modal text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 20,
                  delay: 0.1,
                }}
                className="w-16 h-16 rounded-full bg-sage/15 flex items-center justify-center mx-auto mb-5"
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-sage"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </motion.div>

              <h2 className="font-serif text-2xl text-ink mb-2">
                Request received!
              </h2>
              <p className="text-sm text-muted leading-relaxed mb-4">
                We&apos;ve noted your interest in a private session with{" "}
                <span className="font-medium text-ink">{instructor.name}</span>
                {chosen && (
                  <>
                    {" "}
                    on{" "}
                    <span className="font-medium text-ink">{chosen.time}</span>
                  </>
                )}
                . Our team will reach out within{" "}
                <span className="font-medium text-ink">12 hours</span> to
                confirm availability and details.
              </p>

              {MOCK_USER.pt1on1Credits > 0 && (
                <div className="bg-cyan/10 border border-accent/20 rounded-lg p-3 mb-5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">
                      Your 1-on-1 PT credits
                    </span>
                    <span className="text-xs font-semibold text-accent-deep">
                      {MOCK_USER.pt1on1Credits} credits
                    </span>
                  </div>
                  <p className="text-[10px] text-muted mt-1">
                    Credits will be deducted once the session is confirmed.
                  </p>
                </div>
              )}

              <Link
                href="/account"
                className="block w-full py-3 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent-deep transition-colors"
              >
                Got it
              </Link>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
