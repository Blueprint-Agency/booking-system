import type { Capacity } from "@/types";

export function maxCapacity(c: Capacity): number {
  return c.waitlist + c.onlineBooking + c.buffer;
}
