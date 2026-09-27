// A class's seats on the portal's session page (spec-waitlist.md §2, §10).
//
// Online seats are the members'; buffer seats only staff fill; attendance
// capacity is the two together, and the waitlist is not a seat. The backend
// counts every number here; this file only words them, and words a refused
// staff booking for whoever made it. Shapes mirror
// be/src/routes/portal/class-seats.ts.

import { ApiError, type Api } from "@/lib/api";
import { NOT_ACCEPTED_COPY } from "@/lib/package-rule";
import { formatDate } from "@/lib/formatters";

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
 * a seat past a full buffer; the instructor route ignores it. `clientPackageId`
 * is staff's pick of the member's packages; null lets the Default payer pay.
 */
export function staffBookClass(
  api: Api,
  role: StaffRole,
  classId: string,
  clientId: string,
  overbook = false,
  clientPackageId: string | null = null,
): Promise<StaffBookingResult> {
  return api.post<StaffBookingResult>(`/portal/${role}/schedule/classes/${classId}/bookings`, {
    client_id: clientId,
    ...(overbook ? { overbook: true } : {}),
    ...(clientPackageId ? { client_package_id: clientPackageId } : {}),
  });
}

/* --------------------------- The member's packages -------------------------- */

export type PackageRefusal =
  | "not_accepted"
  | "location_not_covered"
  | "plan_expires_before_class"
  | "insufficient_credits";

/** One of the member's class packages read against the class (#333). */
export interface StaffMemberPackage {
  id: string;
  name: string;
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
  running: boolean;
  /** Credits left; null on an Unlimited Plan. */
  remaining: number | null;
  expires_at: string | null;
  /** Dormant only: the end date picking it would stamp. */
  activation_end_if_picked: string | null;
  location: { id: string; name: string } | null;
  eligible: boolean;
  reason: PackageRefusal | null;
}

export interface StaffMemberPackages {
  /** The package that pays when staff leave the choice alone. */
  default_client_package_id: string | null;
  /** In default order, Ineligible ones included. */
  packages: StaffMemberPackage[];
}

/** The member's class packages for this class, each Eligible or with its reason. */
export function memberPackagesForClass(
  api: Api,
  role: StaffRole,
  classId: string,
  clientId: string,
): Promise<StaffMemberPackages> {
  return api.get<StaffMemberPackages>(`/portal/${role}/schedule/classes/${classId}/packages`, {
    client_id: clientId,
  });
}

export interface PackageOption {
  id: string;
  label: string;
  /** Ineligible: shown, greyed, not choosable. */
  disabled: boolean;
  /** Why it can't pay, or when a Dormant one would run until; null otherwise. */
  note: string | null;
}

export interface PackagePick {
  options: PackageOption[];
  defaultId: string;
}

/** Why a greyed package can't pay, under its name in the select. */
const REFUSAL_NOTE: Record<PackageRefusal, (p: StaffMemberPackage) => string> = {
  not_accepted: () => "Not accepted for this class",
  location_not_covered: (p) => (p.location ? `Covers ${p.location.name} only` : "Doesn't cover this Location"),
  plan_expires_before_class: () => "Ends before this class",
  insufficient_credits: () => "Not enough credits",
};

function refusalNote(p: StaffMemberPackage): string {
  return p.reason ? REFUSAL_NOTE[p.reason](p) : "Can't pay for this class";
}

function optionLabel(p: StaffMemberPackage): string {
  if (p.remaining === null) return `${p.name} · Unlimited`;
  return `${p.name} · ${p.remaining} ${p.remaining === 1 ? "credit" : "credits"} left`;
}

/**
 * Whether staff choose which package pays, as the member would on their Book
 * sheet: only when more than one can. With one or none there is nothing to
 * choose, and the booking goes straight through — the Default payer pays, or
 * the server says why nothing can. Ineligible packages stay in the list,
 * greyed with their reason, so staff can tell the member why.
 */
export function packagePick(res: StaffMemberPackages): PackagePick | null {
  const eligible = res.packages.filter((p) => p.eligible);
  if (eligible.length < 2) return null;
  return {
    defaultId: res.default_client_package_id ?? eligible[0]!.id,
    options: res.packages.map((p) => ({
      id: p.id,
      label: optionLabel(p),
      disabled: !p.eligible,
      note: !p.eligible
        ? refusalNote(p)
        : p.activation_end_if_picked
          ? `Starts today, runs until ${formatDate(p.activation_end_if_picked, "d MMM yyyy")}`
          : null,
    })),
  };
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
  // The class's Package rule accepts none of the member's packages.
  not_accepted: NOT_ACCEPTED_COPY,
  already_booked: "This member is already booked on this class.",
  class_already_started: "This class has already started.",
  class_not_found: "This class is no longer running.",
  client_not_found: "That member can't be found.",
  client_package_not_found: "That package can no longer pay for this class.",
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
