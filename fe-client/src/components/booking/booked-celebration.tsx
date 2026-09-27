"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Download, MapPin, PartyPopper, UserRound } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { BTN_PRIMARY, BTN_SECONDARY, SHEET_BACKDROP, SHEET_HANDLE, SHEET_PANEL } from "@/components/ui/styles";
import { useBrand } from "@/components/brand/brand-provider";
import { formatDate } from "@/lib/utils";
import { formatClassTime, type ApiClassCard } from "@/lib/classes";
import { googleCalendarUrl, icsFile, icsFileName, type CalendarEvent } from "@/lib/add-to-calendar";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * The nudge to remember. One is picked per booking so a regular doesn't read
 * the same joke every week; each ends on the calendar, which is the point.
 */
const NUDGES = [
  "Your mat has a spot with its name on it. The only pose left is remembering to show up — let your calendar hold that one.",
  "Future you is already stretching in gratitude. Present you: pop it in the calendar before it slips.",
  "Downward dog is easy. Remembering it's on is the advanced pose. Your calendar is very good at it.",
  "We've saved you a spot. Your memory is lovely, but your calendar never forgets.",
];

/** Where the confetti flies: an angle and a colour token each. */
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  angle: (360 / 14) * i + (i % 2 ? 8 : -8),
  distance: i % 3 === 0 ? 86 : i % 3 === 1 ? 66 : 54,
  color: ["var(--color-accent)", "var(--color-gold)", "var(--color-cyan)", "var(--color-green)"][i % 4],
}));

/**
 * The moment after a class is booked: a small celebration, what was booked,
 * and a way to put it in the member's calendar — Google's prefilled event, or
 * a `.ics` file for Apple Calendar, Outlook and the rest (`lib/add-to-calendar.ts`).
 */
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
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const brand = useBrand();
  const [nudge] = useState(() => NUDGES[Math.floor(Math.random() * NUDGES.length)]);

  const event = useMemo<CalendarEvent>(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const place = cls.location ? [cls.location.name, cls.location.address].filter(Boolean).join(", ") : null;
    return {
      uid: `booking-${bookingId}@${typeof window === "undefined" ? "reservetoday" : window.location.hostname}`,
      title: `${cls.class_type.name} at ${brand.name}`,
      startsAt: cls.starts_at,
      endsAt: cls.ends_at,
      location: place,
      details: [
        `${cls.class_type.name} with ${cls.instructor.name}.`,
        "Arrive a few minutes early to settle in.",
        origin ? `Your bookings: ${origin}/account/classes` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }, [bookingId, brand.name, cls]);

  const downloadIcs = () => {
    const blob = new Blob([icsFile(event)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(event.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Some browsers read the blob after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`booked-${cls.id}`}
          aria-describedby={`booked-nudge-${cls.id}`}
          tabIndex={-1}
          className={`${SHEET_PANEL} text-center`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          data-testid="booked-celebration"
        >
          <span aria-hidden className={SHEET_HANDLE} />

          <div className="relative mx-auto mt-2 flex h-16 w-16 items-center justify-center">
            <span aria-hidden className="absolute inset-0 rounded-full bg-accent/10 celebrate-ring" />
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                aria-hidden
                className="confetti-bit absolute left-1/2 top-1/2 -ml-[3px] -mt-1 h-2 w-1.5 rounded-[2px]"
                style={
                  {
                    background: c.color,
                    "--confetti-angle": `${c.angle}deg`,
                    "--confetti-distance": `${c.distance}px`,
                    animationDelay: `${150 + (i % 4) * 30}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
            <PartyPopper className="relative h-8 w-8 text-accent-deep celebrate-pop" aria-hidden />
          </div>

          <h3 id={`booked-${cls.id}`} className="mt-4 text-xl font-bold text-ink">
            You&apos;re booked!
          </h3>
          <p id={`booked-nudge-${cls.id}`} className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            {nudge}
          </p>

          <div className="mt-5 rounded-xl bg-ink/[0.04] px-4 py-3 text-left">
            <p className="font-semibold text-ink break-words">{cls.class_type.name}</p>
            <p className="mt-0.5 text-sm font-medium text-ink/80 tabular-nums">
              {formatDate(cls.starts_at)} · {formatClassTime(cls.starts_at)} – {formatClassTime(cls.ends_at)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {cls.location && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {cls.location.name}
                </span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1">
                <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {cls.instructor.name}
              </span>
            </div>
            {paidWith && <p className="mt-1 text-xs text-muted">Paid with {paidWith}</p>}
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <a
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              className={BTN_PRIMARY}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Add to Google Calendar
            </a>
            <button type="button" onClick={downloadIcs} className={BTN_SECONDARY}>
              <Download className="h-4 w-4" aria-hidden />
              Apple / Outlook (.ics)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] text-sm font-semibold text-muted hover:text-ink transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
