import {
  CalendarDays,
  CalendarOff,
  HandHeart,
  QrCode,
  Wallet,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { InstructorPermission } from "@/lib/instructor-permissions";

export interface InstructorNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The Instructor Permission the page needs; absent means every instructor has it. */
  permission?: InstructorPermission;
}

// What an instructor needs to teach is never behind a switch; only PT Requests
// is, since the queue it shows is Take PT bookings' (be/docs/adr/0012).
export const INSTRUCTOR_NAV_ITEMS: InstructorNavItem[] = [
  { label: "My Schedule", href: "/instructor/schedule", icon: CalendarDays },
  { label: "Check-in", href: "/instructor/check-in", icon: QrCode },
  { label: "PT Requests", href: "/instructor/pt-requests", icon: HandHeart, permission: "take_pt_bookings" },
  { label: "My Leave", href: "/instructor/leave", icon: CalendarOff },
  { label: "Teaching log", href: "/instructor/payroll", icon: Wallet },
  { label: "Profile", href: "/instructor/profile", icon: UserRound },
];

/** The nav items this staff member may open, `may` being the workspace's `mayDo`. */
export function instructorNavItems(may: (key: InstructorPermission) => boolean): InstructorNavItem[] {
  return INSTRUCTOR_NAV_ITEMS.filter((item) => !item.permission || may(item.permission));
}
