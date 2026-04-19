import { format, formatDistanceToNow, parseISO } from "date-fns";

/** Money in state is integer cents. Display formats as SGD with no decimals. */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Formats an ISO date string (UTC) to "Mon, Apr 22". */
export function formatDate(iso: string): string {
  return format(parseISO(iso), "EEE, MMM d");
}

/** Formats an ISO datetime to "7:00 AM". */
export function formatTime(iso: string): string {
  return format(parseISO(iso), "h:mm a");
}

/** Combined date + time: "Mon, Apr 22 · 7:00 AM". */
export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "EEE, MMM d · h:mm a");
}

/** "3 hours ago", "in 2 days". */
export function formatRelative(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}
