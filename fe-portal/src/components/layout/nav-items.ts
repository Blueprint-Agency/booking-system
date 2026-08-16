import type { LucideIcon } from "lucide-react";
import {
  Tag,
  DoorOpen,
  Shield,
  Layers,
  UserRound,
  Briefcase,
  GraduationCap,
  CalendarDays,
  CalendarOff,
  QrCode,
  HandHeart,
  Users,
  Mail,
  FileText,
  UserCog,
  Wallet,
} from "lucide-react";

export type NavScope = "global" | "workspace" | "both";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Role visibility: who can see the item (superadmin vs admin). NOT location filtering. */
  scope: NavScope;
  /**
   * True when the surface's data changes with the topbar workspace switcher
   * (filtered by the active location). These render in the "workspace zone" at the
   * top of the sidebar, under a header named after the active location. Distinct
   * from `scope`, which is about role visibility.
   */
  workspaceScoped?: boolean;
  badgeKey?: "inboxUnread" | "ptRequestsPending" | "corporateRequestsPending";
}

export type NavGroup = "Config" | "Packages" | "Corporate" | "People" | "Finance" | "Settings";

export const NAV_ITEMS: NavItem[] = [
  // --- Workspace zone (switcher-controlled; rendered at top under the location name) ---
  // group is ignored for workspaceScoped items (they render in the workspace zone),
  // but must still be a valid NavGroup for the type.
  { group: "Settings", label: "Schedule", href: "/admin/schedule", icon: CalendarDays, scope: "workspace", workspaceScoped: true },
  { group: "Settings", label: "Check-in", href: "/admin/check-in", icon: QrCode, scope: "workspace", workspaceScoped: true },
  // PT Requests IS location-scoped: pt_requests.location_id is set at request time
  // (the client picks a studio), so both this list and the pending badge filter by the
  // active workspace. Contrast Corporate below, which has no location until scheduled.
  { group: "Settings", label: "PT Requests", href: "/admin/pt-requests", icon: HandHeart, scope: "workspace", workspaceScoped: true, badgeKey: "ptRequestsPending" },
  { group: "Settings", label: "Rooms", href: "/admin/rooms", icon: DoorOpen, scope: "both", workspaceScoped: true },

  // --- Config (global building blocks, shared across locations) ---
  { group: "Config", label: "Class Types", href: "/admin/class-types", icon: Tag, scope: "global" },

  // --- Packages (global, shared across locations) ---
  { group: "Packages", label: "Classes", href: "/admin/classes", icon: Layers, scope: "global" },
  { group: "Packages", label: "Workshops", href: "/admin/packages/workshops", icon: GraduationCap, scope: "global" },
  { group: "Packages", label: "Private Sessions", href: "/admin/private-sessions", icon: UserRound, scope: "global" },
  { group: "Packages", label: "Corporate", href: "/admin/packages/corporate", icon: Briefcase, scope: "global" },

  // --- Corporate (workspace-AGNOSTIC; no location_id until scheduled, so NOT
  // filtered by the workspace switcher — lives in its own group, not the location zone) ---
  { group: "Corporate", label: "Corporate Requests", href: "/admin/corporate-requests", icon: HandHeart, scope: "both", badgeKey: "corporateRequestsPending" },

  // --- People (members + staff accounts) ---
  // Instructors are managed under Staff → Instructors tab (merged), not a separate item.
  { group: "People", label: "Customers", href: "/admin/clients", icon: Users, scope: "both" },
  // Admins reach Staff too — they can edit profiles of their own rank and below.
  // Invite/archive/unarchive/delete stay superadmin-only on the page and at the BE
  // (spec-instructor-leave-pools.md § Permissions).
  { group: "People", label: "Staff", href: "/admin/staff", icon: UserCog, scope: "both" },
  // Leave is instructor-wide and has no location, so it is not workspace-scoped.
  // Both roles decide requests (spec-instructor-leave.md § Access and visibility).
  { group: "People", label: "Leave", href: "/admin/leave", icon: CalendarOff, scope: "both" },

  // --- Finance (operations surface; both roles view records + edit pay) ---
  { group: "Finance", label: "Payroll", href: "/admin/payroll", icon: Wallet, scope: "both" },

  // --- Settings (location-independent policy + config) ---
  { group: "Settings", label: "Global Policy", href: "/admin/policy", icon: Shield, scope: "global" },
  { group: "Settings", label: "Notifications", href: "/admin/notifications", icon: Mail, scope: "global" },
  { group: "Settings", label: "Waiver", href: "/admin/waiver", icon: FileText, scope: "global" },
];

export const NAV_GROUP_ORDER: NavGroup[] = ["Config", "Packages", "Corporate", "People", "Finance", "Settings"];
