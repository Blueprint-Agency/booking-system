import { CalendarDays, GraduationCap, Ticket, User, type LucideIcon } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/", label: "Schedule", icon: CalendarDays, isActive: (p) => p === "/" || p.startsWith("/private-sessions") },
  { href: "/workshops", label: "Workshops", icon: GraduationCap, isActive: (p) => p.startsWith("/workshops") },
  { href: "/packages", label: "Packages", icon: Ticket, isActive: (p) => p.startsWith("/packages") },
  { href: "/account", label: "Account", icon: User, isActive: (p) => p.startsWith("/account") },
];
