// A class's waitlist on the portal's session page (spec-waitlist.md §7, §10):
// the panel's rows, Add to class, Remove, and the waitlist half of a full
// class's Add member prompt. The backend decides everything — who is next,
// whether a package can pay, which seat a member takes; this file calls it and
// words what it said. Shapes mirror be/src/routes/portal/class-seats.ts and
// class-waitlist.ts.

import { ApiError, type Api } from "@/lib/api";
import { fetchFeatureFlags, WAITLIST_FLAG } from "@/lib/feature-flags";
import {
  staffBookingRefusal,
  staffRefusalCopy,
  type StaffBookingResult,
  type StaffRole,
} from "@/lib/class-seats";

export type SelectionRefusal =
  | "insufficient_credits"
  | "location_not_covered"
  | "plan_expires_before_class";

/** Whether the member's packages could pay if they were added now. */
export type WaitlistPaymentStatus =
  | { status: "pending"; package_name: string }
  | { status: "cannot_pay"; reason: SelectionRefusal };

export interface WaitlistRow {
  entry_id: string;
  position: number;
  client: { id: string; name: string };
  joined_at: string;
  payment_status: WaitlistPaymentStatus;
}

/** The waitlist fields of a class's session read. */
export interface ClassWaitlist {
  capacity_waitlist: number;
  waiting: number;
  waitlist_enabled: boolean;
  waitlist: WaitlistRow[];
}

const CANNOT_PAY: Record<SelectionRefusal, string> = {
  insufficient_credits: "no package with enough credits",
  location_not_covered: "their plan doesn't cover this studio",
  plan_expires_before_class: "their plan ends before the class",
};

/** "Pending: <package>" or "Can't pay: <reason>". */
export function paymentStatusLine(p: WaitlistPaymentStatus): string {
  return p.status === "pending"
    ? `Pending: ${p.package_name}`
    : `Can't pay: ${CANNOT_PAY[p.reason] ?? p.reason}`;
}

/** The session page's "Waitlist N / M" stat. */
export function waitlistStat(c: Pick<ClassWaitlist, "waiting" | "capacity_waitlist">): string {
  return `${c.waiting} / ${c.capacity_waitlist}`;
}

/** A timetable cell's "+N waiting", or nothing when the line is empty. */
export function waitingTag(waiting: number | null | undefined): string | null {
  return waiting && waiting > 0 ? `+${waiting} waiting` : null;
}

/** The capacity form's Waitlist label. Unknown (still loading) reads as the plain label. */
export function waitlistFieldLabel(waitlistsOn: boolean | undefined): string {
  return waitlistsOn === false ? "Waitlist (waitlists are off)" : "Waitlist";
}

/* ------------------------------ Add member ------------------------------ */

export type StaffBookingPrompt =
  | { kind: "full"; message: string; canOverbook: boolean; canWaitlist: boolean }
  | { kind: "error"; message: string };

/**
 * A refused staff booking, as the Add member prompt asks it (§7). A full class
 * whose line is open offers the waitlist: an admin is asked "Overbook, or add
 * to the waitlist?", an instructor "Add to the waitlist?". A closed line leaves
 * the plain full-class question.
 */
export function staffBookingPrompt(err: unknown, role: StaffRole): StaffBookingPrompt {
  const refusal = staffBookingRefusal(err, role);
  if (refusal.kind !== "full") return refusal;
  const open = err instanceof ApiError && (err.body as { waitlist_open?: boolean } | null)?.waitlist_open === true;
  if (!open) return { ...refusal, canWaitlist: false };
  return role === "admin"
    ? { kind: "full", message: "No seats left. Overbook, or add to the waitlist?", canOverbook: true, canWaitlist: true }
    : { kind: "full", message: "No seats left. Add to the waitlist?", canOverbook: false, canWaitlist: true };
}

/** Staff put a member in a full class's line — the member's own join, made from the portal. */
export function staffJoinWaitlist(
  api: Api,
  role: StaffRole,
  classId: string,
  clientId: string,
): Promise<{ entry_id: string; position: number }> {
  return api.post(`/portal/${role}/schedule/classes/${classId}/waitlist`, { client_id: clientId });
}

const JOIN_REFUSAL_COPY: Record<string, string> = {
  waitlist_full: "The waitlist for this class is full.",
  waitlist_disabled: "Waitlists are turned off for the studio.",
  already_waitlisted: "This member is already on the waitlist.",
  class_not_full: "A seat has come free — add the member to the class instead.",
};

/** Why staff couldn't put a member in the line: the member's own join refusals, in staff terms. */
export function staffJoinRefusal(err: unknown): string {
  if (!(err instanceof ApiError)) return "Network error";
  const body = err.body as { error?: string; window_hours?: number } | null;
  if (body?.error === "waitlist_closed") {
    return `This class starts within ${body.window_hours ?? "a few"} hours, so the waitlist has closed.`;
  }
  const code = body?.error;
  return (
    (code ? JOIN_REFUSAL_COPY[code] : undefined) ??
    staffRefusalCopy(code) ??
    `Couldn't add the member to the waitlist (HTTP ${err.status}).`
  );
}

/* ---------------------------- Add to class ---------------------------- */

/** Book a waiting member onto the class, whatever the Cancellation Window says. */
export function promoteWaitlistEntry(
  api: Api,
  role: StaffRole,
  classId: string,
  entryId: string,
  overbook = false,
): Promise<StaffBookingResult> {
  return api.post<StaffBookingResult>(
    `/portal/${role}/schedule/classes/${classId}/waitlist/${entryId}/promote`,
    overbook ? { overbook: true } : {},
  );
}

/** Take a member out of the line. */
export async function removeWaitlistEntry(
  api: Api,
  role: StaffRole,
  classId: string,
  entryId: string,
): Promise<void> {
  await api.del(`/portal/${role}/schedule/classes/${classId}/waitlist/${entryId}`);
}

export type AddToClassRefusal =
  | { kind: "full"; message: string; canOverbook: true }
  | { kind: "error"; message: string };

/**
 * What a waitlist row says when Add to class is refused. Only an admin is asked
 * to overbook; the instructor is told there is no seat. Anything else — a
 * package that can't pay above all — is shown on the row, and the member keeps
 * their place.
 */
export function addToClassRefusal(err: unknown, role: StaffRole): AddToClassRefusal {
  const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  if (code === "waitlist_entry_not_found") {
    return { kind: "error", message: "This member is no longer on the waitlist." };
  }
  const refusal = staffBookingRefusal(err, role);
  if (refusal.kind === "error") return refusal;
  return role === "admin"
    ? { kind: "full", message: "No seats left. Overbook?", canOverbook: true }
    : { kind: "error", message: "No seats left." };
}

/**
 * Whether the studio has waitlists on, for a scheduling form's capacity fields.
 * Admins read the switchboard; instructors read the switches their forms need.
 */
export async function fetchWaitlistsOn(api: Api, role: StaffRole): Promise<boolean> {
  if (role === "admin") {
    return (await fetchFeatureFlags(api)).some((f) => f.key === WAITLIST_FLAG && f.enabled);
  }
  const res = await api.get<{ waitlist_enabled: boolean }>("/portal/instructor/catalog/features");
  return res.waitlist_enabled;
}
