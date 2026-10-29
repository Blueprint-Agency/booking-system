// ClassPass review (be-portal.md §classpass.ts): the ClassPass emails
// the importer could not place, or kept while it was off, and the three ways
// an Admin closes one.
// Shapes mirror be/src/routes/portal/admin/classpass.ts.

import type { Api } from "@/lib/api";
import type { ClassPassLocationMapping, ClassPassOutcome } from "@/lib/classpass";
import type { ApiScheduleEntry } from "@/lib/use-schedule";

export type ClassPassReviewReason =
  | "unparsed"
  | "unmapped_location"
  | "no_class"
  | "ambiguous_class"
  | "class_cancelled"
  | "client_deleted"
  | "already_booked"
  | "import_off"
  | "import_error";

export interface ClassPassReviewItem {
  id: string;
  /** A booking, or a cancellation kept while the import was off. */
  kind: "booking" | "cancellation";
  received_at: string;
  subject: string;
  outcome: ClassPassOutcome;
  reason: ClassPassReviewReason | null;
  reservation_id: string | null;
  class_name: string | null;
  /** As ClassPass wrote it. */
  location_name: string | null;
  starts_at: string | null;
  member_name: string | null;
  member_email: string | null;
  text: string | null;
  html: string | null;
  booking_id: string | null;
  resolved_at: string | null;
  resolved_by_staff_id: string | null;
}

/** Why the importer could not place it, in the page's words. */
export function reviewReasonLabel(reason: ClassPassReviewReason | null): string {
  switch (reason) {
    case "unparsed":
      return "Couldn’t read the email";
    case "unmapped_location":
      return "Location not mapped";
    case "no_class":
      return "No class at that time";
    case "ambiguous_class":
      return "More than one class at that time";
    case "class_cancelled":
      return "Class cancelled";
    case "client_deleted":
      return "Member was removed";
    case "already_booked":
      return "Member already on the class";
    case "import_off":
      return "Arrived while the import was off";
    case "import_error":
      return "Couldn’t be imported";
    default:
      return "For review";
  }
}

/**
 * Whether "Book into a class" can be offered, as the backend books it: a
 * booking whose email named the reservation and the member (the picked class
 * gives the time and place), for a member the studio has not removed.
 */
export function canBook(item: ClassPassReviewItem): boolean {
  return (
    item.kind === "booking" &&
    item.reason !== "client_deleted" &&
    Boolean(item.reservation_id && item.member_email && item.member_name)
  );
}

/** The day around the email's time (or its arrival) to look for classes in. */
export function classSearchWindow(item: ClassPassReviewItem): { from: string; to: string } {
  const at = new Date(item.starts_at ?? item.received_at).getTime();
  const HALF_DAY = 12 * 60 * 60 * 1000;
  return { from: new Date(at - HALF_DAY).toISOString(), to: new Date(at + HALF_DAY).toISOString() };
}

/** The classes an Admin can book into: not cancelled, nearest the email's time first. */
export function classChoices(entries: ApiScheduleEntry[], item: ClassPassReviewItem): ApiScheduleEntry[] {
  const at = new Date(item.starts_at ?? item.received_at).getTime();
  return entries
    .filter((e) => e.kind === "class" && e.event_state !== "cancelled")
    .sort(
      (a, b) =>
        Math.abs(new Date(a.starts_at).getTime() - at) - Math.abs(new Date(b.starts_at).getTime() - at) ||
        a.starts_at.localeCompare(b.starts_at),
    );
}

export async function listClassPassReview(api: Api): Promise<ClassPassReviewItem[]> {
  const res = await api.get<{ items: ClassPassReviewItem[] }>("/portal/admin/classpass/review");
  return res.items;
}

export async function listClassesNear(api: Api, item: ClassPassReviewItem): Promise<ApiScheduleEntry[]> {
  const res = await api.get<{ entries: ApiScheduleEntry[] }>("/portal/admin/schedule", {
    ...classSearchWindow(item),
    type: "class",
  });
  return classChoices(res.entries, item);
}

export function bookClassPassReviewItem(api: Api, id: string, classId: string): Promise<ClassPassReviewItem> {
  return api.post<ClassPassReviewItem>(`/portal/admin/classpass/review/${id}/book`, { class_id: classId });
}

export function dismissClassPassReviewItem(api: Api, id: string): Promise<ClassPassReviewItem> {
  return api.post<ClassPassReviewItem>(`/portal/admin/classpass/review/${id}/dismiss`);
}

export function mapClassPassReviewLocation(
  api: Api,
  id: string,
  locationId: string,
): Promise<{ mapping: ClassPassLocationMapping; items: ClassPassReviewItem[] }> {
  return api.post(`/portal/admin/classpass/review/${id}/location`, { location_id: locationId });
}

/**
 * The ClassPass location names open review items wait on, each once (as the
 * backend matches them: case and spacing aside), with the oldest item that
 * names it: mapping from that item maps the name for every item.
 */
export function unmappedLocations(items: ClassPassReviewItem[]): { name: string; itemId: string; count: number }[] {
  const byName = new Map<string, { name: string; itemId: string; count: number }>();
  for (const item of items) {
    if (item.reason !== "unmapped_location" || !item.location_name || item.resolved_at) continue;
    const key = item.location_name.trim().replace(/\s+/g, " ").toLowerCase();
    const seen = byName.get(key);
    if (seen) seen.count += 1;
    else byName.set(key, { name: item.location_name.trim(), itemId: item.id, count: 1 });
  }
  return [...byName.values()];
}

/** The toast after mapping a location from a review item. */
export function mappedSummary(items: ClassPassReviewItem[]): string {
  const imported = items.filter((i) => i.resolved_at).length;
  const open = items.length - imported;
  const booked = imported === 1 ? "1 booking imported" : `${imported} bookings imported`;
  return open === 0 ? `Location mapped. ${booked}.` : `Location mapped. ${booked}, ${open} still for review.`;
}
