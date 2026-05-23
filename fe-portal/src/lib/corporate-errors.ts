import { ApiError } from "@/lib/api";

/**
 * Maps backend `corporate_sessions` error codes to user-facing copy.
 * Used by the create form and the detail/edit page.
 */
export function corporateErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Network error";
  const body = (err.body as { error?: string } | null) ?? null;
  switch (body?.error) {
    case "room_conflict":
      return "That room is already booked at that time.";
    case "instructor_conflict":
      return "The main instructor has another session at that time.";
    case "package_archived":
      return "This corporate package is archived and can't be scheduled.";
    case "main_in_supporting":
      return "An instructor can't be both main and supporting.";
    case "bad_time_range":
      return "End time must be after start time.";
    case "package_not_found":
      return "Corporate package not found.";
    case "not_found":
      return "Corporate session not found.";
    default:
      return `Failed (HTTP ${err.status})`;
  }
}
