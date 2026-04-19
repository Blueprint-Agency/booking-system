import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Location } from "@/types";
import locationsData from "@/data/locations.json";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

const typedLocations = locationsData as Location[];

export function getLocation(locationId: string | null): Location | undefined {
  if (!locationId) return undefined;
  return typedLocations.find((l) => l.id === locationId);
}

export function getLocationName(locationId: string | null): string {
  return getLocation(locationId)?.shortName ?? "—";
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}
