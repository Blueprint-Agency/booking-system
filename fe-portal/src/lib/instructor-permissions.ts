/**
 * **Instructor Permissions** (be/CONTEXT.md § Staff, be/docs/adr/0012): three
 * switches an Admin sets per Instructor. The backend refuses, the portal hides;
 * this is the one place the portal decides what to hide, so every button and
 * nav item that depends on a switch asks `mayDo` rather than reading the role.
 */
import type { StaffRole } from "@/types";

/** Every Instructor Permission, in the order the Staff page lists them. */
export const INSTRUCTOR_PERMISSIONS = [
  "schedule_classes",
  "take_pt_bookings",
  "manage_rosters",
] as const;

export type InstructorPermission = (typeof INSTRUCTOR_PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<InstructorPermission, string> = {
  schedule_classes: "Schedule classes",
  take_pt_bookings: "Take PT bookings",
  manage_rosters: "Manage rosters",
};

export const PERMISSION_HINT: Record<InstructorPermission, string> = {
  schedule_classes: "Create classes and weekly series, and cancel a class they lead.",
  take_pt_bookings: "See the PT request queue, take requests, and cancel a PT session they lead.",
  manage_rosters: "Add members to their classes, work the waitlist, and cancel a member's booking.",
};

function isPermission(key: unknown): key is InstructorPermission {
  return (INSTRUCTOR_PERMISSIONS as readonly unknown[]).includes(key);
}

/**
 * The known permissions in `keys`, in the canonical order. A key this portal
 * does not know (one the backend added later) is dropped: no button asks for
 * it, so it can grant nothing here.
 */
export function knownPermissions(keys: readonly unknown[] | null | undefined): InstructorPermission[] {
  const held = new Set((keys ?? []).filter(isPermission));
  return INSTRUCTOR_PERMISSIONS.filter(k => held.has(k));
}

/**
 * Whether this staff member may do what `key` grants. An Admin always may,
 * whatever the array says; an Instructor may when the key is held; no staff
 * member (still loading, or refused) may not.
 */
export function mayDo(
  staff: { role: StaffRole; permissions: readonly unknown[] } | null | undefined,
  key: InstructorPermission,
): boolean {
  if (!staff) return false;
  if (staff.role === "admin") return true;
  return staff.permissions.includes(key);
}
