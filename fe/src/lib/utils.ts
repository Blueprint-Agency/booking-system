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

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export function spotsText(booked: number, capacity: number): string {
  const remaining = capacity - booked;
  if (remaining <= 0) return "Full";
  if (remaining <= 3) return `${remaining} spots left`;
  return `${remaining} spots left`;
}

const typedLocations = locationsData as Location[];

export function getLocation(locationId: string | null): Location | undefined {
  if (!locationId) return undefined;
  return typedLocations.find((l) => l.id === locationId);
}

export function getLocationName(locationId: string | null): string {
  return getLocation(locationId)?.shortName ?? "";
}

export function getTenantLocations(tenantId: string): Location[] {
  return typedLocations.filter((l) => l.tenantId === tenantId);
}
