import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  BookOpen,
  Sparkles,
  UserCog,
  Package,
  Receipt,
  Bell,
  Settings,
  ScrollText,
  QrCode,
  Gift,
  Heart,
  Flag,
  Activity,
  User,
  Clock,
  RotateCcw,
  XCircle,
  ShieldCheck,
  Shield,
  UserCheck,
  Star,
} from "lucide-react";
import type { AdminState } from "@/lib/admin-state";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeSelector?: (s: AdminState) => number | undefined;
  section?: string;
}

const pendingPrivate = (s: AdminState) =>
  s.privateRequests.filter((r) => r.status === "pending").length || undefined;

const pendingRefunds = (s: AdminState) =>
  s.refundRequests.filter((r) => r.status === "open").length || undefined;

const pendingCancellations = (s: AdminState) =>
  s.cancellationRequests.filter((r) => r.status === "open").length || undefined;

export const NAV_ITEMS_ADMIN: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { section: "People", label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Instructors", href: "/admin/instructors", icon: UserCog },
  { label: "Bookings", href: "/admin/bookings", icon: BookOpen },
  { label: "Check-in", href: "/admin/check-in", icon: QrCode },
  { section: "Schedule", label: "Schedule", href: "/admin/schedule", icon: CalendarDays },
  { label: "Classes", href: "/admin/classes", icon: BookOpen },
  { label: "Workshops", href: "/admin/workshops", icon: Sparkles },
  { label: "Private sessions", href: "/admin/private/inbox", icon: Heart, badgeSelector: pendingPrivate },
  { section: "Inboxes", label: "Refunds", href: "/admin/refunds", icon: RotateCcw, badgeSelector: pendingRefunds },
  { label: "Cancellations", href: "/admin/cancellations", icon: XCircle, badgeSelector: pendingCancellations },
  { section: "Catalogue", label: "Packages", href: "/admin/packages", icon: Package },
  { label: "Invoices", href: "/admin/invoices", icon: Receipt },
  { label: "Referrals", href: "/admin/referrals", icon: Gift },
  { section: "System", label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Settings", href: "/admin/settings/policy", icon: Settings },
  { label: "Audit", href: "/admin/audit", icon: ScrollText },
];

export const NAV_ITEMS_INSTRUCTOR: NavItem[] = [
  { label: "Today", href: "/instructor", icon: LayoutDashboard },
  { label: "My schedule", href: "/instructor/schedule", icon: CalendarDays },
  { label: "My availability", href: "/instructor/availability", icon: Clock },
  { label: "Teaching log", href: "/instructor/teaching-log", icon: ScrollText },
  { label: "Ratings", href: "/instructor/ratings", icon: Star },
  { label: "My profile", href: "/instructor/profile", icon: User },
];

export const NAV_ITEMS_SUPER: NavItem[] = [
  { label: "Overview", href: "/superadmin", icon: LayoutDashboard },
  { label: "Health", href: "/superadmin/health", icon: Activity },
  { label: "Flags", href: "/superadmin/flags", icon: Flag },
  { label: "Templates", href: "/superadmin/templates", icon: ScrollText },
  { label: "Admins", href: "/superadmin/admins", icon: UserCog },
  { label: "Audit", href: "/superadmin/audit", icon: Shield },
  { label: "Impersonate", href: "/superadmin/impersonate", icon: UserCheck },
  { label: "Waivers reset", href: "/superadmin/waivers/reset", icon: ShieldCheck },
];
