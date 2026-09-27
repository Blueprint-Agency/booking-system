/**
 * "Add to calendar" for a booked class, with no sign-in to anyone's calendar.
 *
 * **Google Calendar** takes an event template in a URL (`action=TEMPLATE`).
 * It opens Google's own "new event" form, prefilled; the member presses Save.
 * Writing the event silently would need OAuth with a calendar-write scope —
 * a consent screen and a stored token for one event, which is more than the
 * click is worth and more access than a booking app should hold.
 *
 * Times go out in UTC (`…Z`): the calendar shows them in the member's own zone,
 * and nothing here has to know which zone the studio is in.
 */

export interface CalendarEvent {
  /** Stable per thing booked. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  details: string;
}

/** `2026-09-28T01:00:00.000Z` → `20260928T010000Z`, the form Google's `dates` takes. */
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
