import {
  Building2,
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  ShoppingBag,
  UserCircle,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type AccountNavItem = {
  href: string;
  label: string;
  /** One line under the label in the mobile account menu. */
  hint: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const prefix = (href: string) => (p: string) => p.startsWith(href);

export const ACCOUNT_OVERVIEW: AccountNavItem = {
  href: "/account",
  label: "Overview",
  hint: "Credits, packages and what's next",
  icon: LayoutDashboard,
  isActive: (p) => p === "/account",
};

/** The account's sections, in the order both navs list them. */
export const ACCOUNT_SECTIONS: AccountNavItem[] = [
  { href: "/account/classes", label: "Classes", hint: "Upcoming, ongoing and past bookings", icon: CalendarCheck, isActive: prefix("/account/classes") },
  { href: "/account/private-sessions", label: "Private sessions", hint: "Your PT requests and sessions", icon: UserRound, isActive: prefix("/account/private-sessions") },
  { href: "/account/workshops", label: "Workshops", hint: "Workshops you've booked", icon: GraduationCap, isActive: prefix("/account/workshops") },
  { href: "/account/corporate", label: "Corporate", hint: "Corporate package requests", icon: Building2, isActive: prefix("/account/corporate") },
  { href: "/account/merch", label: "Merch", hint: "Items to collect at the studio", icon: ShoppingBag, isActive: prefix("/account/merch") },
  { href: "/account/profile", label: "Profile & security", hint: "Details, saved cards, password", icon: UserCircle, isActive: prefix("/account/profile") },
];
