import {
  CalendarCheck,
  Settings,
  ShoppingBag,
  Sprout,
  Ticket,
  UserCircle,
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

/**
 * The account's sections, in the order the desktop sidebar and the mobile
 * account menu (on `/account`, under "Up next") both list them.
 */
export const ACCOUNT_SECTIONS: AccountNavItem[] = [
  { href: "/account/bookings", label: "My bookings", hint: "Classes, PT, workshops and requests", icon: CalendarCheck, isActive: prefix("/account/bookings") },
  { href: "/account/practice", label: "My activity", hint: "Sessions you've attended", icon: Sprout, isActive: prefix("/account/practice") },
  { href: "/account/packages", label: "My packages", hint: "Active, not started and ended", icon: Ticket, isActive: prefix("/account/packages") },
  { href: "/account/merch", label: "Merch", hint: "Items to collect at the studio", icon: ShoppingBag, isActive: prefix("/account/merch") },
  { href: "/account/profile", label: "Profile & security", hint: "Details, saved cards, password", icon: UserCircle, isActive: prefix("/account/profile") },
  { href: "/account/settings", label: "General settings", hint: "Theme and text size", icon: Settings, isActive: prefix("/account/settings") },
];
