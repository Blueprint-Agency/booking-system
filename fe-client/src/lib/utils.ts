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

/** Compact `S$1,234` price tag used across catalogue cards. */
export function formatSgd(price: string | number): string {
  const n = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(n)) return "S$0";
  return `S$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Human label for a package duration. Whole months read as "N months";
 * anything else stays in days so 45 days never misleads as "2 months".
 */
export function formatDurationDays(days: number): string {
  if (days > 0 && days % 30 === 0) {
    const months = days / 30;
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
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
