import type { LucideIcon } from "lucide-react";
import {
  Tag,
  DoorOpen,
  Shield,
  Layers,
  Heart,
  Sparkles,
  CalendarDays,
  QrCode,
  HandHeart,
  Users,
  Mail,
  FileText,
  UserCog,
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
  badgeKey?: "inboxUnread" | "ptRequestsPending";
}

export type NavGroup = "Packages" | "People" | "Settings";

export const NAV_ITEMS: NavItem[] = [
  // --- Workspace zone (switcher-controlled; rendered at top under the location name) ---
  // group is ignored for workspaceScoped items (they render in the workspace zone),
  // but must still be a valid NavGroup for the type.
  { group: "Settings", label: "Schedule", href: "/admin/schedule", icon: CalendarDays, scope: "workspace", workspaceScoped: true },
  { group: "Settings", label: "Check-in", href: "/admin/check-in", icon: QrCode, scope: "workspace", workspaceScoped: true },
  // Grouped in the location zone for navigation, but PT Requests is a workspace-AGNOSTIC
  // shared triage queue (no location_id until scheduled) — it is NOT filtered by the switcher.
  { group: "Settings", label: "PT Requests", href: "/admin/pt-requests", icon: HandHeart, scope: "workspace", workspaceScoped: true, badgeKey: "ptRequestsPending" },
  { group: "Settings", label: "Rooms", href: "/admin/rooms", icon: DoorOpen, scope: "both", workspaceScoped: true },

  // --- Packages (global, shared across locations) ---
  { group: "Packages", label: "Classes", href: "/admin/classes", icon: Layers, scope: "global" },
  { group: "Packages", label: "Workshops", href: "/admin/packages/workshops", icon: Sparkles, scope: "global" },
  { group: "Packages", label: "Private Sessions", href: "/admin/private-sessions", icon: Heart, scope: "global" },

  // --- People (members + staff accounts) ---
  // Instructors are managed under Staff → Instructors tab (merged), not a separate item.
  { group: "People", label: "Clients", href: "/admin/clients", icon: Users, scope: "both" },
  { group: "People", label: "Staff", href: "/admin/staff", icon: UserCog, scope: "global" },

  // --- Settings (location-independent building blocks + config) ---
  { group: "Settings", label: "Class Types", href: "/admin/class-types", icon: Tag, scope: "global" },
  { group: "Settings", label: "Global Policy", href: "/admin/policy", icon: Shield, scope: "global" },
  { group: "Settings", label: "Notifications", href: "/admin/notifications", icon: Mail, scope: "global" },
  { group: "Settings", label: "Waiver", href: "/admin/waiver", icon: FileText, scope: "global" },
];

export const NAV_GROUP_ORDER: NavGroup[] = ["Packages", "People", "Settings"];
