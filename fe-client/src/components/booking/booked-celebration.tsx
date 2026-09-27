"use client";

import { useMemo } from "react";
import { useBrand } from "@/components/brand/brand-provider";
import {
  CelebrationDetails,
  CelebrationSheet,
  accountLink,
  calendarUid,
  usePickedLine,
} from "@/components/celebration/celebration-sheet";
import { formatDate } from "@/lib/utils";
import { formatClassTime, type ApiClassCard } from "@/lib/classes";
import type { CalendarEvent } from "@/lib/add-to-calendar";

/** The nudge to remember; each ends on the calendar, which is the point. */
const NUDGES = [
  "Your mat has a spot with its name on it. The only pose left is remembering to show up — let your calendar hold that one.",
  "Future you is already stretching in gratitude. Present you: pop it in the calendar before it slips.",
  "Downward dog is easy. Remembering it's on is the advanced pose. Your calendar is very good at it.",
  "We've saved you a spot. Your memory is lovely, but your calendar never forgets.",
];

/** The moment after a class is booked (fe-client-features §3.1). */
export function BookedCelebration({
  cls,
  bookingId,
  paidWith,
  onClose,
}: {
  cls: ApiClassCard;
  bookingId: string;
  /** Named only when the member had packages to choose between. */
  paidWith: string | null;
  onClose: () => void;
}) {
  const brand = useBrand();
  const nudge = usePickedLine(NUDGES);

  const event = useMemo<CalendarEvent>(() => {
    const link = accountLink("/account/classes");
    return {
      uid: calendarUid(`booking-${bookingId}`),
      title: `${cls.class_type.name} at ${brand.name}`,
      startsAt: cls.starts_at,
      endsAt: cls.ends_at,
      location: cls.location ? [cls.location.name, cls.location.address].filter(Boolean).join(", ") : null,
      details: [
        `${cls.class_type.name} with ${cls.instructor.name}.`,
        "Arrive a few minutes early to settle in.",
        link ? `My bookings: ${link}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }, [bookingId, brand.name, cls]);

  return (
    <CelebrationSheet
      id={`booked-${cls.id}`}
      title="You're booked!"
      line={nudge}
      event={event}
      onClose={onClose}
      testId="booked-celebration"
    >
      <CelebrationDetails
        name={cls.class_type.name}
        when={`${formatDate(cls.starts_at)} · ${formatClassTime(cls.starts_at)} – ${formatClassTime(cls.ends_at)}`}
        place={cls.location?.name ?? null}
        person={cls.instructor.name}
        note={paidWith ? `Paid with ${paidWith}` : null}
      />
    </CelebrationSheet>
  );
}
