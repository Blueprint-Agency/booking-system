import type { LucideIcon } from "lucide-react";
import {
  MapPin,
  Tag,
  Users2,
  Shield,
  Layers,
  Heart,
  CalendarDays,
  Clock,
  QrCode,
  Inbox,
  Users,
  Mail,
  FileText,
  UserCog,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroup;
  badgeKey?: "inboxUnread";
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
  { group: "Building Blocks", label: "Locations", href: "/admin/locations", icon: MapPin },
  { group: "Building Blocks", label: "Class Types", href: "/admin/class-types", icon: Tag },
  { group: "Building Blocks", label: "Instructors", href: "/admin/instructors", icon: Users2 },

  { group: "Policy", label: "Global Policy", href: "/admin/policy", icon: Shield },

  { group: "Packages", label: "Classes", href: "/admin/classes", icon: Layers },
  { group: "Packages", label: "Private Sessions", href: "/admin/private-sessions", icon: Heart },

  { group: "Schedule", label: "Schedule", href: "/admin/schedule", icon: CalendarDays },
  { group: "Schedule", label: "Availability", href: "/admin/availability", icon: Clock },

  { group: "Operations", label: "Check-in", href: "/admin/check-in", icon: QrCode },
  { group: "Operations", label: "Inbox", href: "/admin/inbox", icon: Inbox, badgeKey: "inboxUnread" },

  { group: "Clients & Content", label: "Clients", href: "/admin/clients", icon: Users },
  { group: "Clients & Content", label: "Notifications", href: "/admin/notifications", icon: Mail },
  { group: "Clients & Content", label: "Waiver", href: "/admin/waiver", icon: FileText },

  { group: "Admin", label: "Staff", href: "/admin/staff", icon: UserCog },
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
