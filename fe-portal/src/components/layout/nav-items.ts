import type { LucideIcon } from "lucide-react";
import {
  Tag,
  Users2,
  Shield,
  Layers,
  Heart,
  Sparkles,
  CalendarDays,
  QrCode,
  Inbox,
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
  scope: NavScope;
  badgeKey?: "inboxUnread" | "ptRequestsPending";
}

export type NavGroup =
  | "Building Blocks"
  | "Policy"
  | "Packages"
  | "Schedule"
  | "Operations"
  | "Clients & Content"
  | "Admin";

export const NAV_ITEMS: NavItem[] = [
  // Locations entry removed — now lives in the topbar workspace switcher.
  { group: "Building Blocks", label: "Class Types", href: "/admin/class-types", icon: Tag, scope: "global" },
  { group: "Building Blocks", label: "Instructors", href: "/admin/instructors", icon: Users2, scope: "both" },

  { group: "Policy", label: "Global Policy", href: "/admin/policy", icon: Shield, scope: "global" },

  { group: "Packages", label: "Classes", href: "/admin/classes", icon: Layers, scope: "global" },
  { group: "Packages", label: "Workshops", href: "/admin/packages/workshops", icon: Sparkles, scope: "workspace" },
  { group: "Packages", label: "Private Sessions", href: "/admin/private-sessions", icon: Heart, scope: "global" },

  { group: "Schedule", label: "Schedule", href: "/admin/schedule", icon: CalendarDays, scope: "workspace" },

  { group: "Operations", label: "Check-in", href: "/admin/check-in", icon: QrCode, scope: "workspace" },
  {
    group: "Operations",
    label: "PT Requests",
    href: "/admin/pt-requests",
    icon: HandHeart,
    scope: "workspace",
    badgeKey: "ptRequestsPending",
  },
  { group: "Operations", label: "Inbox", href: "/admin/inbox", icon: Inbox, scope: "workspace", badgeKey: "inboxUnread" },

  { group: "Clients & Content", label: "Clients", href: "/admin/clients", icon: Users, scope: "both" },
  { group: "Clients & Content", label: "Notifications", href: "/admin/notifications", icon: Mail, scope: "global" },
  { group: "Clients & Content", label: "Waiver", href: "/admin/waiver", icon: FileText, scope: "global" },

  { group: "Admin", label: "Staff", href: "/admin/staff", icon: UserCog, scope: "global" },
];

export const NAV_GROUP_ORDER: NavGroup[] = [
  "Building Blocks",
  "Policy",
  "Packages",
  "Schedule",
  "Operations",
  "Clients & Content",
  "Admin",
];
