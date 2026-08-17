import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Full currency formatting — whole dollars stay whole, cents show when present. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Compact `S$1,234` price tag used across catalogue cards. Whole dollars stay
 * whole; cents are shown when present so a S$30.50 price never renders as S$31
 * (the card price must match what Stripe charges).
 */
export function formatSgd(price: string | number): string {
  const n = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(n)) return "S$0";
  return `S$${n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Human label for a package Duration, which is whole calendar months. The
 * days-based version this replaces guessed at months by dividing by 30, so the
 * catalogue's 365-day "12-Month Unlimited" rendered as "365 days".
 */
export function formatDurationMonths(months: number): string {
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** "Thu, 12 Jun" in studio time — both studios are in Singapore. */
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Singapore",
  });
}
