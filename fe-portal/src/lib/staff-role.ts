import type { NavScope } from "@/components/layout/nav-items";
import type { StaffRole } from "@/types";

/**
 * Whether this staff member runs the studio: every admin surface, every
 * location, every action. An admin does everything a superadmin could (#148);
 * `superadmin` stays in until the role itself is removed.
 */
export function runsStudio(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

/** Whether a nav item shows for `role`: studio admins see all of them. */
export function visibleToRole(
  item: { scope: NavScope },
  role: StaffRole | null | undefined,
): boolean {
  return item.scope === "both" || runsStudio(role);
}
