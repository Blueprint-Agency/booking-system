/**
 * "Your bookings": everything a member holds at the studio — classes, PT
 * sessions and requests, workshops, corporate requests — as one list, each
 * placed in Upcoming, Ongoing, Past or Cancelled. Pure, so the placing is
 * tested (`my-bookings.test.ts`) apart from the page that draws it.
 *
 * A request still waiting on the studio (a pending PT or corporate request)
 * counts as Upcoming: it is something coming, and it can still be cancelled.
 * Past holds only what was held. Whatever its kind, a cancellation is on
 * Cancelled from the moment it is cancelled, whatever its time, sorted by its
 * cancel time (#349, #351): a class, a PT request cancelled or expired (or a
 * seat the member left), a workshop place, a corporate request.
 */
import type { ApiBooking } from "@/components/account/class-bookings";
import type { ApiWorkshopBooking } from "@/components/account/workshop-bookings";
import type { RawPtRequest } from "@/lib/pt-sessions";
import type { ApiCorporateRequest } from "@/lib/corporate";

export type BookingType = "class" | "pt" | "workshop" | "corporate";
export type BookingPhase = "upcoming" | "ongoing" | "past" | "cancelled";

interface Base {
  /** Unique across types: `${type}:${id}`. */
  key: string;
  phase: BookingPhase;
  /** What the list sorts by. */
  at: string;
}

export type BookingItem =
  | (Base & { type: "class"; booking: ApiBooking })
  | (Base & { type: "pt"; request: RawPtRequest })
  | (Base & { type: "workshop"; booking: ApiWorkshopBooking })
  | (Base & { type: "corporate"; request: ApiCorporateRequest });

export interface BookingSources {
  /** `GET /me/bookings/upcoming` — classes not yet started. */
  upcoming: ApiBooking[];
  /** `GET /me/bookings/past` — classes held: started, running or ended, not cancelled. */
  past: ApiBooking[];
  /** `GET /me/bookings/cancelled` — cancelled classes, any time, with their cancellation. */
  cancelled: ApiBooking[];
  pt: RawPtRequest[];
  workshops: ApiWorkshopBooking[];
  corporate: ApiCorporateRequest[];
}

const ms = (iso: string) => new Date(iso).getTime();

/** By its times: not started, running, or over. */
function byTime(startsAt: string, endsAt: string | null, now: number): BookingPhase {
  if (ms(startsAt) > now) return "upcoming";
  if (endsAt && ms(endsAt) > now) return "ongoing";
  return "past";
}

/** A PT request's first proposed slot, as an instant at midday studio time. */
function firstSlot(r: RawPtRequest): string | null {
  const s = r.slots[0];
  return s ? `${s.proposed_date.slice(0, 10)}T12:00:00+08:00` : null;
}

/** On Cancelled an item sorts by its cancel time; elsewhere, by its own. */
const cancelledAt = (phase: BookingPhase, cancelled: string | null | undefined, own: string) =>
  phase === "cancelled" ? (cancelled ?? own) : own;

export function bookingItems(src: BookingSources, now: number): BookingItem[] {
  const items: BookingItem[] = [];

  for (const b of src.upcoming) {
    items.push({ type: "class", key: `class:${b.booking_id}`, phase: "upcoming", at: b.starts_at, booking: b });
  }
  for (const b of src.past) {
    const running = b.state === "confirmed" && ms(b.ends_at) > now;
    items.push({
      type: "class",
      key: `class:${b.booking_id}`,
      phase: running ? "ongoing" : "past",
      at: b.starts_at,
      booking: b,
    });
  }
  for (const b of src.cancelled) {
    items.push({
      type: "class",
      key: `class:${b.booking_id}`,
      phase: "cancelled",
      at: b.cancelled_at ?? b.starts_at,
      booking: b,
    });
  }

  for (const r of src.pt) {
    const at = r.session?.starts_at ?? firstSlot(r) ?? r.created_at;
    let phase: BookingPhase;
    if (r.status === "pending") phase = "upcoming";
    else if (r.status === "scheduled" && r.session) phase = byTime(r.session.starts_at, r.session.ends_at, now);
    else if (r.status.startsWith("cancelled_")) phase = "cancelled";
    else phase = "past";
    items.push({ type: "pt", key: `pt:${r.id}`, phase, at: cancelledAt(phase, r.cancelled_at, at), request: r });
  }

  for (const w of src.workshops) {
    let phase: BookingPhase;
    if (w.state === "cancelled") phase = "cancelled";
    else if (!w.starts_at) phase = "upcoming";
    else phase = byTime(w.starts_at, w.ends_at ?? w.starts_at, now);
    const at = cancelledAt(phase, w.cancelled_at, w.starts_at ?? w.booked_at);
    items.push({ type: "workshop", key: `workshop:${w.id}`, phase, at, booking: w });
  }

  for (const r of src.corporate) {
    let phase: BookingPhase;
    if (r.status === "pending") phase = "upcoming";
    else if (r.status === "scheduled") phase = r.session ? byTime(r.session.starts_at, r.session.ends_at, now) : "upcoming";
    else if (r.status === "cancelled") phase = "cancelled";
    else phase = "past";
    const at = cancelledAt(phase, r.cancelled_at, r.session?.starts_at ?? r.created_at);
    items.push({ type: "corporate", key: `corporate:${r.id}`, phase, at, request: r });
  }

  return items;
}

/** Where a PT request or session stands on its card; null for a held session nobody ticked. */
export type PtStanding = "pending" | "confirmed" | "attended" | "no_show" | "cancelled" | "expired" | null;

/**
 * A held private session reads by the member's own booking's check-in, as a
 * class does (#351): "Attended" only when ticked, "No-show" only when staff
 * marked them absent, and nothing for one held but never ticked. The request's
 * `attended` status says only that its session ended.
 */
export function ptStanding(r: RawPtRequest): PtStanding {
  switch (r.status) {
    case "pending":
      return "pending";
    case "scheduled":
      return "confirmed";
    case "attended": {
      const ticked = r.booking?.check_in_state;
      return ticked === "attended" || ticked === "no_show" ? ticked : null;
    }
    default:
      return r.expired ? "expired" : "cancelled";
  }
}

/**
 * Soonest first while it is still to come; most recent first once it is over;
 * newest cancellation first on Cancelled (a cancelled item is `at` its cancel).
 */
export function sortForPhase(items: BookingItem[], phase: BookingPhase): BookingItem[] {
  const dir = phase === "past" || phase === "cancelled" ? -1 : 1;
  return [...items].sort((a, b) => dir * a.at.localeCompare(b.at));
}

/** An instant's date on the studio's calendar, as every date the app shows is. */
const studioDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

/**
 * The bookings My activity counts on one day (`YYYY-MM-DD`), earliest first:
 * a class or private session attended then, or booked and not checked in —
 * still to come, or held and never ticked. What a day of the week or month
 * opens to, as the same cards My bookings draws.
 */
export function sessionsOnDay(items: BookingItem[], date: string): BookingItem[] {
  return sortForPhase(
    items.filter((i) => {
      // What the day's tile counted (`GET /me/bookings/attendance`): attended,
      // or booked and not checked in, whether or not it has started. A
      // no-show and a cancellation are in neither.
      if (i.type === "class") {
        const counted =
          i.booking.check_in_state === "attended" ||
          (i.booking.state === "confirmed" && (i.phase === "upcoming" || i.booking.check_in_state === "pending"));
        return counted && studioDate(i.at) === date;
      }
      if (i.type === "pt") {
        const s = i.request.session;
        // The request turns `attended` once its session ends, ticked or not;
        // the member's own booking says whether they were marked a no-show.
        const counted =
          (i.request.status === "attended" || i.request.status === "scheduled") &&
          i.request.booking?.check_in_state !== "no_show";
        return counted && !!s && studioDate(s.starts_at) === date;
      }
      return false;
    }),
    "upcoming",
  );
}
