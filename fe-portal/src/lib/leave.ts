// How leave reads on screen — the labels, the date formatting and the refusal
// sentence, shared by the instructor leave page, the admin leave queue and the
// leave calendar. Presentation only: nothing here decides anything. Every rule
// (balance, backdating, clashes, half-day boundary) lives in the backend.

import { formatDate } from "./formatters";
import { ApiError } from "./api";

export type LeaveType = "annual" | "medical" | "study";

export type LeaveStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "cancelled"
  | "revoked";

export type HalfDay = "none" | "morning" | "afternoon";

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: "Annual",
  medical: "Medical",
  study: "Study",
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

export const LEAVE_STATUS_TONE: Record<
  LeaveStatus,
  "warning" | "sage" | "error" | "neutral"
> = {
  pending: "warning",
  approved: "sage",
  rejected: "error",
  withdrawn: "neutral",
  cancelled: "neutral",
  revoked: "error",
};

/** Half days split the day at 1pm Singapore time — the same boundary the
 *  backend enforces when it decides what a booking clashes with. */
export const LEAVE_HALF_DAY_SUFFIX: Record<HalfDay, string> = {
  none: "",
  morning: " · morning",
  afternoon: " · afternoon",
};

/** The same marker where there is no room for a word — a calendar chip. */
export const LEAVE_HALF_DAY_SHORT: Record<HalfDay, string> = {
  none: "",
  morning: " (AM)",
  afternoon: " (PM)",
};

/** A plain `YYYY-MM-DD` — never parsed as an instant, so no timezone shifting. */
export function formatLeaveDay(day: string): string {
  return formatDate(`${day}T00:00:00`, "d MMM yyyy");
}

export function formatLeaveDayRange(from: string, to: string): string {
  return from === to
    ? formatLeaveDay(from)
    : `${formatLeaveDay(from)} – ${formatLeaveDay(to)}`;
}

/** The backend's refusals carry the sentence to show; fall back only if one doesn't. */
export function leaveErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    if (body && typeof body.message === "string") return body.message;
    return `${fallback} (HTTP ${err.status}).`;
  }
  return fallback;
}
