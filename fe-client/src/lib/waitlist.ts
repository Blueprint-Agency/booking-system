/**
 * A member's place in a full class's line (spec-waitlist.md §9; be-client.md
 * `waitlist.ts`).
 *
 * The rules — who may join, when the line closes, who is promoted — are the
 * backend's (`be/src/services/waitlist/`). What lives here is what the member
 * app decides for itself: which button a class row shows, and what a refusal
 * says. Both are pure, so each can be tested against the state that produces it.
 *
 * `Api` is imported as a type only, so this module loads under `node --test`
 * without the browser session behind the real client.
 */
import type { Api } from "./api.ts";
import { ERROR_CODES } from "./error-codes.ts";
import { notAcceptedCopy, notCoveredCopy, planRunsOutCopy } from "./booking-copy.ts";

/** The member's own entry, as the catalogue's `waitlist.my_entry` states it. */
export interface WaitlistPlace {
  id: string;
  position: number;
}

/** Every class card's line — `waitlist` on `/public/classes` and `/me/classes`. */
export interface ApiClassWaitlist {
  /** The studio's waitlist switch. */
  enabled: boolean;
  capacity: number;
  waiting: number;
  /** Enabled, class active, before the Cancellation Window, and room in the line. */
  open: boolean;
  /** Always null on the public route. */
  my_entry: WaitlistPlace | null;
}

/** One row of `GET /me/waitlist`. */
export interface ApiWaitlistEntry {
  id: string;
  class_id: string;
  name: string;
  instructor: string;
  location: string;
  starts_at: string;
  ends_at: string;
  joined_at: string;
  position: number;
}

export function joinWaitlist(api: Api, classId: string): Promise<{ entry_id: string; position: number }> {
  return api.post(`/me/waitlist/classes/${classId}`);
}

export function leaveWaitlist(api: Api, entryId: string): Promise<unknown> {
  return api.del(`/me/waitlist/${entryId}`);
}

export async function listWaitlist(api: Api): Promise<ApiWaitlistEntry[]> {
  const res = await api.get<{ entries: ApiWaitlistEntry[] }>("/me/waitlist");
  return res.entries ?? [];
}

export interface ClassActionInput {
  booked: boolean;
  myEntry: WaitlistPlace | null;
  spotsLeft: number;
  waitlistOpen: boolean;
  /**
   * Nothing the member holds can pay here: their plans cover other studios and
   * they hold no credits (class-row.tsx). Only matters for a free seat.
   */
  notCovered: boolean;
  /**
   * The class's Package rule takes none of the packages the member holds —
   * learnt from the class detail or a refused join, never guessed from the
   * list. Optional: a row that has not learnt it offers Book as usual.
   */
  notAccepted?: boolean;
}

export type ClassAction =
  | "booked"
  | "waitlisted"
  | "book"
  | "not_covered"
  | "not_accepted"
  | "join_waitlist"
  | "full";

/**
 * The class row's button, in the precedence §9 sets: Booked, then the member's
 * place in line, then a free seat, then the waitlist, then Full. A booked
 * class never shows a waitlist control. A class that takes none of the
 * member's packages offers neither a seat nor a place in line: both would be
 * refused `not_accepted`.
 */
export function classAction(s: ClassActionInput): ClassAction {
  if (s.booked) return "booked";
  if (s.myEntry) return "waitlisted";
  if (s.spotsLeft > 0) return s.notAccepted ? "not_accepted" : s.notCovered ? "not_covered" : "book";
  if (!s.waitlistOpen) return "full";
  return s.notAccepted ? "not_accepted" : "join_waitlist";
}

/** The toast on joining. There is no email on join, so this and My Bookings are all the member sees. */
export function joinedToast(position: number): string {
  return `Class is full — you're #${position} on the waitlist. We'll book you in and email you if a seat opens.`;
}

export type WaitlistRefusal =
  /**
   * Tell the member. `closed`: the line no longer takes joins, so the row reads Full. `refresh`: re-read the row.
   * `notAccepted`: the class takes none of the member's packages, so the row stops offering it.
   */
  | { kind: "message"; msg: string; closed?: true; refresh?: true; notAccepted?: true }
  /** The row is stale (already booked, already in line): re-read it rather than explain. */
  | { kind: "refresh" }
  /** Nothing can pay: the same "You need a package" dialog booking opens. */
  | { kind: "no_package" };

function bodyNumber(body: unknown, key: string): number | null {
  if (body && typeof body === "object") {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * What a refused join or leave tells the member. The package-selection codes
 * read exactly as they do when booking — it is the same selection refusing.
 * `null` is a code this does not know; the caller shows its generic message.
 */
export function waitlistRefusal(
  code: string,
  body: unknown,
  planLocationName: string | null = null,
): WaitlistRefusal | null {
  switch (code) {
    case ERROR_CODES.waitlist_closed: {
      const hours = bodyNumber(body, "window_hours");
      return {
        kind: "message",
        msg:
          hours === null
            ? "This class starts soon, so the waitlist has closed."
            : `This class starts within ${hours} hour${hours === 1 ? "" : "s"}, so the waitlist has closed.`,
        closed: true,
      };
    }
    case ERROR_CODES.waitlist_full:
      return { kind: "message", msg: "The waitlist for this class is full.", closed: true };
    case ERROR_CODES.waitlist_disabled:
      return { kind: "message", msg: "This studio isn't taking waitlist sign-ups right now.", closed: true };
    case ERROR_CODES.class_not_full:
      return { kind: "message", msg: "A spot just opened in this class — you can book it now.", refresh: true };
    case ERROR_CODES.class_not_found:
      return { kind: "message", msg: "This class is no longer running.", refresh: true };
    case ERROR_CODES.waitlist_entry_not_found:
      return { kind: "message", msg: "You're no longer on this waitlist.", refresh: true };
    case ERROR_CODES.already_waitlisted:
    case ERROR_CODES.already_booked:
      return { kind: "refresh" };
    case ERROR_CODES.insufficient_credits:
      return { kind: "no_package" };
    case ERROR_CODES.location_not_covered:
      return { kind: "message", msg: notCoveredCopy(planLocationName) };
    case ERROR_CODES.plan_expires_before_class:
      // Booking's copy. A join names no package: the Default payer is chosen
      // at promotion, and this is the first reason in default order.
      return { kind: "message", msg: planRunsOutCopy() };
    case ERROR_CODES.not_accepted:
      // A join names no package, so this is the server saying the class's
      // Package rule takes none of them (`refusalOf` in selection.ts).
      return { kind: "message", msg: notAcceptedCopy(), notAccepted: true };
    default:
      return null;
  }
}
