import type { Capacity } from "@/types";

/**
 * The most people a session holds without an overbook: online plus buffer
 * seats. The waitlist is a line, not a seat (spec-waitlist.md §1).
 */
function attendanceCapacity(c: Capacity): number {
  return c.onlineBooking + c.buffer;
}

export function capacityProblem(c: Capacity): string | null {
  return c.onlineBooking + c.waitlist + c.buffer > 0
    ? null
    : "Give the class at least one online, buffer or waitlist place.";
}

/** The line under the capacity fields. */
export function capacityLine(c: Capacity): string {
  return `Attendance capacity: ${attendanceCapacity(c)} · Waitlist: ${c.waitlist}`;
}
