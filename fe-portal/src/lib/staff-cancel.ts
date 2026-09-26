// A staff member cancels one member's class booking (#320), from the class
// roster (admin and instructor) or the admin member profile. Every cancel asks
// Return credit or Keep credit, with neither picked; the backend's
// `cancel_preview` on the row carries everything the question needs.

import { ApiError } from "./api";
import type { StaffRole } from "./class-seats";

export type StaffCredit = "return" | "keep";

/** `cancel_preview` on a roster row or member booking; null where no cancel is offered. */
export interface StaffCancelPreview {
  /** Credits the booking spent — 0 on an Unlimited plan. */
  credits: number;
  /** The package that paid; a Return goes back to it. */
  package_name: string | null;
  unlimited: boolean;
  /** The class is already inside its Cancellation Window. */
  late: boolean;
}

export interface StaffCancelCopy {
  title: string;
  /** Whether the class is inside its window — said on every cancel. */
  window: string;
  /** The choice; null when the booking spent nothing and there is none. */
  options: { value: StaffCredit; label: string }[] | null;
  /** Said instead of the choice when nothing was spent. */
  nothingSpent: string | null;
  keep: string;
  confirm: string;
}

export function staffCancelCopy(p: StaffCancelPreview, name: string): StaffCancelCopy {
  const one = p.credits === 1;
  const spent = p.credits > 0;
  return {
    title: `Cancel ${name}'s booking?`,
    window: p.late
      ? "The class is already inside its cancellation window."
      : "The class is not yet inside its cancellation window.",
    options: spent
      ? [
          {
            value: "return",
            label: `Return ${p.credits} ${one ? "credit" : "credits"} to ${p.package_name ?? "their package"}`,
          },
          { value: "keep", label: `Keep the ${one ? "credit" : "credits"} — recorded as a late cancel` },
        ]
      : null,
    nothingSpent: spent
      ? null
      : p.unlimited
        ? "Their plan is unlimited, so no credit was spent — nothing to return or keep."
        : "No credit was spent on this booking — nothing to return or keep.",
    keep: "Keep booking",
    confirm: "Cancel booking",
  };
}

/** Confirm stays disabled until a choice is made — unless there is nothing to choose. */
export function staffCancelCanConfirm(p: StaffCancelPreview, choice: StaffCredit | null): boolean {
  return p.credits === 0 || choice !== null;
}

/** The body the route takes. Nothing spent: either answer is `n_a`, so send Return. */
export function staffCancelBody(p: StaffCancelPreview, choice: StaffCredit | null): { credit: StaffCredit } {
  return { credit: p.credits === 0 ? "return" : (choice ?? "return") };
}

export function staffCancelPath(role: StaffRole, bookingId: string): string {
  return `/portal/${role}/bookings/${bookingId}/cancel`;
}

const REFUSALS: Record<string, string> = {
  booking_attended: "They're marked attended. Untick them first, then cancel.",
  not_your_session: "This class is not one you are teaching.",
  not_cancellable: "This booking is no longer booked. Reload to see it.",
};

/** A refused cancel, in staff's words; the server's own sentence otherwise. */
export function staffCancelRefusal(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: unknown; message?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : null;
    if (code && REFUSALS[code]) return REFUSALS[code];
    if (typeof body?.message === "string" && body.message) return body.message;
    return `Couldn't cancel the booking (HTTP ${err.status}).`;
  }
  return "Couldn't cancel the booking — check the connection.";
}
