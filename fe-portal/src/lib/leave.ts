// How leave reads on screen — the labels, the date formatting and the refusal
// sentence, shared by both "My leave" pages, the admin leave queue and the
// leave calendar. Presentation only: nothing here decides anything. Every rule
// (balance, backdating, clashes, half-day boundary) lives in the backend.

import { formatDate } from "./formatters";
import { ApiError } from "./api";

/** The self-service leave mount, one for both roles: leave belongs to a staff
 *  member, admin or instructor. */
export const OWN_LEAVE_PATH = "/portal/leave";

export type LeaveType = "annual" | "medical" | "study";

export type LeaveStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "cancelled"
  | "revoked";

export type HalfDay = "none" | "morning" | "afternoon";

/** One Leave Type's year, as `GET /portal/leave` sends it. */
export interface ApiLeaveBalance {
  type: LeaveType;
  /** The yearly figure on my profile. */
  assigned_days: number;
  /** Part of the Pool, brought in from last year. Only annual ever carries. */
  carried_days: number;
  /** What leave is drawn from this year. Normally assigned + carried, but an
   *  admin's adjustment can move it, so it is sent rather than added up here. */
  pool_days: number;
  taken_days: number;
  pending_days: number;
  remaining_days: number;
}

/** One of my own requests, as `GET /portal/leave` sends it. */
export interface ApiOwnLeaveRequest {
  id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  half_day: HalfDay;
  days: number;
  leave_year: number;
  status: LeaveStatus;
  reason: string;
  decision_reason: string | null;
  created_at: string;
  /** The key is never sent — only whether there is a Supporting Document. */
  has_supporting_document: boolean;
}

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
