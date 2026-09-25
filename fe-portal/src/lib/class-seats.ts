// A class's seats on the portal's session page (spec-waitlist.md §2, §10).
//
// Online seats are the members'; buffer seats only staff fill; attendance
// capacity is the two together, and the waitlist is not a seat. The backend
// counts every number here; this file only words them, and words a refused
// staff booking for whoever made it. Shapes mirror
// be/src/routes/portal/class-seats.ts.

import { ApiError, type Api } from "@/lib/api";

export type BookingSeat = "online" | "buffer" | "overbook";
export type StaffRole = "admin" | "instructor";

export interface ClassSeats {
  capacity_online: number;
  capacity_buffer: number;
  attendance_capacity: number;
  online_used: number;
  buffer_used: number;
  overbook_used: number;
  attending: number;
}

export interface SeatsSummary {
  /** "Booked": people in seats over attendance capacity. */
  booked: string;
  seats: string;
  /** Null when nobody is overbooked. */
  overbooked: string | null;
}

export function seatsSummary(c: ClassSeats): SeatsSummary {
  return {
    booked: `${c.attending} / ${c.attendance_capacity}`,
    seats: `${c.online_used} / ${c.capacity_online} online · ${c.buffer_used} / ${c.capacity_buffer} buffer`,
    overbooked: c.overbook_used > 0 ? `${c.overbook_used} overbooked` : null,
  };
}

/** The roster tag for a seat. Online seats are the ordinary case and carry none. */
export function seatTag(seat: BookingSeat): string | null {
  if (seat === "buffer") return "Buffer";
  if (seat === "overbook") return "Overbook";
  return null;
}

/* ------------------------------ Staff booking ------------------------------ */

export interface StaffBookingResult {
  booking_id: string;
  seat: BookingSeat;
  qr_token: string;
  code: string;
}

/**
 * Book a member onto a class from the session page. An admin's `overbook` takes
 * a seat past a full buffer; the instructor route ignores it.
 */
export function staffBookClass(
  api: Api,
  role: StaffRole,
  classId: string,
  clientId: string,
  overbook = false,
): Promise<StaffBookingResult> {
  return api.post<StaffBookingResult>(`/portal/${role}/schedule/classes/${classId}/bookings`, {
    client_id: clientId,
    ...(overbook ? { overbook: true } : {}),
  });
}

export interface MemberMatch {
  id: string;
  name: string;
  email: string;
}

/** Members matching `q`, for Add member. Each role searches through its own surface. */
export async function searchMembers(api: Api, role: StaffRole, q: string): Promise<MemberMatch[]> {
  if (role === "admin") {
    const res = await api.get<{ clients: MemberMatch[] }>("/portal/admin/clients", {
      q,
      filter: "active",
      sort: "name",
      page: 1,
      page_size: 10,
    });
    return res.clients.map((c) => ({ id: c.id, name: c.name, email: c.email }));
  }
  const res = await api.get<{ clients: MemberMatch[] }>("/portal/instructor/clients", { q });
  return res.clients;
}

export type StaffBookingRefusal =
  | { kind: "full"; message: string; canOverbook: boolean }
  | { kind: "error"; message: string };

const REFUSAL_COPY: Record<string, string> = {
  insufficient_credits: "This member has no package that can pay for this class.",
  location_not_covered: "This member's plan doesn't cover this studio.",
  plan_expires_before_class: "This member's plan ends before the class.",
  already_booked: "This member is already booked on this class.",
  class_already_started: "This class has already started.",
  class_not_found: "This class is no longer running.",
  client_not_found: "That member can't be found.",
  not_your_session: "This class is not one you are teaching.",
};

/** Staff copy for a refusal booking and the waitlist share, or undefined for a code it doesn't know. */
export function staffRefusalCopy(code: string | undefined): string | undefined {
  return code ? REFUSAL_COPY[code] : undefined;
}

/**
 * What to tell staff when a booking is refused. A full class is a question, not
 * an error: an admin may overbook, an instructor may not. Offering the waitlist
 * as well is `staffBookingPrompt` in `./class-waitlist`.
 */
export function staffBookingRefusal(err: unknown, role: StaffRole): StaffBookingRefusal {
  if (!(err instanceof ApiError)) return { kind: "error", message: "Network error" };
  const code = (err.body as { error?: string } | null)?.error;
  if (code === "class_full") {
    return role === "admin"
      ? { kind: "full", message: "No seats left. Overbook?", canOverbook: true }
      : { kind: "full", message: "No seats left.", canOverbook: false };
  }
  const known = code ? REFUSAL_COPY[code] : undefined;
  return { kind: "error", message: known ?? `Couldn't add the member (HTTP ${err.status}).` };
}
