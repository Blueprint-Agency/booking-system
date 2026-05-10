import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function spotsText(booked: number, capacity: number): string {
  const remaining = capacity - booked;
  if (remaining <= 0) return "Full";
  return `${remaining} spots left`;
}
