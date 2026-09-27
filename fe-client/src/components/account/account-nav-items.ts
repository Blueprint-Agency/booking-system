import {
  CalendarCheck,
  ShoppingBag,
  Ticket,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

export type AccountNavItem = {
  href: string;
  label: string;
  /** One line under the label, for a screen reader's link description. */
  hint: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const prefix = (href: string) => (p: string) => p.startsWith(href);

/**
 * The account's landing page: every booking and request the member holds —
 * classes, PT, workshops, corporate — in one list with its own filters.
 */
export const ACCOUNT_OVERVIEW: AccountNavItem = {
  href: "/account",
  label: "Your bookings",
  hint: "Classes, PT, workshops and requests",
  icon: CalendarCheck,
  isActive: (p) => p === "/account",
};

/** The account's other sections, in the order both navs list them. */
export const ACCOUNT_SECTIONS: AccountNavItem[] = [
  { href: "/account/packages", label: "Your packages", hint: "Active, not started and ended", icon: Ticket, isActive: prefix("/account/packages") },
  { href: "/account/merch", label: "Merch", hint: "Items to collect at the studio", icon: ShoppingBag, isActive: prefix("/account/merch") },
  { href: "/account/profile", label: "Profile & security", hint: "Details, saved cards, password", icon: UserCircle, isActive: prefix("/account/profile") },
];
