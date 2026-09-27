"use client";

import { useState } from "react";
import { CalendarPlus, MapPin, PartyPopper, UserRound } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { BTN_PRIMARY, SHEET_BACKDROP, SHEET_HANDLE, SHEET_PANEL } from "@/components/ui/styles";
import { googleCalendarUrl, type CalendarEvent } from "@/lib/add-to-calendar";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

/** Where the confetti flies: an angle, a distance and a colour token each. */
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  angle: (360 / 14) * i + (i % 2 ? 8 : -8),
  distance: i % 3 === 0 ? 86 : i % 3 === 1 ? 66 : 54,
  color: ["var(--color-accent)", "var(--color-gold)", "var(--color-cyan)", "var(--color-green)"][i % 4],
}));

/** One of `lines`, picked once per sheet, so a regular doesn't read the same joke every time. */
export function usePickedLine(lines: readonly string[]): string {
  const [line] = useState(() => lines[Math.floor(Math.random() * lines.length)]!);
  return line;
}

/**
 * The small celebration after something good happens to the member — a class
 * booked, a request sent, a request approved. A confetti burst (none under
 * reduced motion), the headline, one light line, what it was about, and, when
 * there is a time to keep, the way into their calendar: Google's prefilled
 * event (`lib/add-to-calendar.ts`).
 */
export function CelebrationSheet({
  id,
  title,
  line,
  event,
  onClose,
  testId,
  children,
}: {
  /** Unique on the page: names the dialog's title and description. */
  id: string;
  title: string;
  line: string;
  /** Offered to the member's calendar; null when there is no time yet. */
  event: CalendarEvent | null;
  onClose: () => void;
  testId?: string;
  /** What it was about: usually a `CelebrationDetails`. */
  children?: React.ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-line`}
          tabIndex={-1}
          className={`${SHEET_PANEL} text-center`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          data-testid={testId}
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

          <h3 id={`${id}-title`} className="mt-4 text-xl font-bold text-ink">
            {title}
          </h3>
          <p id={`${id}-line`} className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            {line}
          </p>

          {children}

          <div className="mt-6 flex flex-col gap-2">
            {event && (
              <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer" className={BTN_PRIMARY}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Add to Google Calendar
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className={
                event
                  ? "min-h-[44px] text-sm font-semibold text-muted hover:text-ink transition-colors"
                  : BTN_PRIMARY
              }
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** What the celebration is about: a name, a line of when, and where and with whom. */
export function CelebrationDetails({
  name,
  when,
  place,
  person,
  note,
}: {
  name: string;
  when: string | null;
  place: string | null;
  person: string | null;
  /** A last small line, e.g. which package paid. */
  note?: string | null;
}) {
  return (
    <div className="mt-5 rounded-xl bg-ink/[0.04] px-4 py-3 text-left">
      <p className="font-semibold text-ink break-words">{name}</p>
      {when && <p className="mt-0.5 text-sm font-medium text-ink/80 tabular-nums">{when}</p>}
      {(place || person) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {place && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {place}
            </span>
          )}
          {person && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {person}
            </span>
          )}
        </div>
      )}
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** The link back to where a member manages what they booked, for a calendar event's description. */
export function accountLink(path: string): string | null {
  return typeof window === "undefined" ? null : `${window.location.origin}${path}`;
}

/** A calendar UID for this studio's host, stable per thing celebrated. */
export function calendarUid(key: string): string {
  return `${key}@${typeof window === "undefined" ? "reservetoday" : window.location.hostname}`;
}
