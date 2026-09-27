/**
 * "Add to calendar" for a booked class, with no sign-in to anyone's calendar.
 *
 * Two ways in, because members keep their diary in different places:
 *
 * - **Google Calendar** takes an event template in a URL (`action=TEMPLATE`).
 *   It opens Google's own "new event" form, prefilled; the member presses Save.
 *   Writing the event silently would need OAuth with a calendar-write scope —
 *   a consent screen and a stored token for one event, which is more than the
 *   click is worth and more access than a booking app should hold.
 * - **Everything else** (Apple Calendar, Outlook, Proton, …) reads an iCalendar
 *   file (RFC 5545), so the same event is also offered as a `.ics` download.
 *
 * Times go out in UTC (`…Z`): the calendar shows them in the member's own zone,
 * and nothing here has to know which zone the studio is in.
 */

export interface CalendarEvent {
  /** Stable across downloads, so re-adding the same booking updates rather than duplicates. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  details: string;
}

/** `2026-09-28T01:00:00.000Z` → `20260928T010000Z`, the form both formats take. */
export function calendarStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Google Calendar's prefilled "new event" page for the event. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${calendarStamp(event.startsAt)}/${calendarStamp(event.endsAt)}`,
    details: event.details,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** A TEXT value: backslash, semicolon, comma and newline are escaped (RFC 5545 §3.3.11). */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Lines longer than 75 octets are folded onto continuation lines that start
 * with a space (RFC 5545 §3.1). Counted in UTF-8 bytes, and never splitting a
 * character, so a class or studio name in any script survives intact.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // The first line holds 75 octets; a continuation line spends one on its space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The event as an iCalendar file, with a reminder an hour before. */
export function icsFile(event: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReserveToday//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${calendarStamp(now.toISOString())}`,
    `DTSTART:${calendarStamp(event.startsAt)}`,
    `DTEND:${calendarStamp(event.endsAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(event.details)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT1H",
    `DESCRIPTION:${icsText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A file name the member will recognise in their downloads. */
export function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "class"}.ics`;
}
