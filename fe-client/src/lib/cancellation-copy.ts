/**
 * What a member is told about cancelling, worded from the studio's own policy.
 *
 * The rule these sentences describe is the backend's
 * (`be/src/services/policy/evaluate-cancellation.ts`), and it is not the one a
 * member would guess:
 *
 *   - A class can be cancelled until it starts. Inside its window the cancel
 *     is a **late cancellation**: it goes through and the credit is not
 *     returned (#318).
 *   - In time, the credit (or PT session) comes back while the member is under
 *     the cap on cancellations per cycle — or always, when the studio has
 *     switched the cap off. Over it, the cancel still goes through and the
 *     credit is lost.
 *   - A scheduled PT session cannot be cancelled inside its window at all — the
 *     server refuses.
 *   - An Unlimited booking cost nothing, so nothing comes back — the place is
 *     freed. It still counts toward the cap.
 *   - A PT request that is still pending always returns its sessions.
 *
 * Pure functions of the policy, so each sentence can be tested against the
 * numbers that produce it. Nothing here says "refund": a credit coming back to
 * a package is not money coming back to a card.
 */

/** The studio's cancellation rules, as `GET /public/cancellation-policy` states them. */
export interface CancellationPolicy {
  class_window_hours: number;
  pt_window_hours: number;
  /** Off: every cancel made in time returns, and nothing is said of a cap. */
  cancel_cap_enabled: boolean;
  cancel_cap_count: number;
  cancel_cap_cycle_days: number;
}

/** What cancelling one class booking would do now, as `GET /me/bookings/:id` previews it. */
export interface CancelPreview {
  /** Inside the class's window: a late cancellation. */
  late: boolean;
  /** Whether the credits spent come back. */
  credit_back: boolean;
  /** Credits the booking spent — 0 on an Unlimited Plan. */
  credits: number;
  unlimited: boolean;
}

const HOUR_MS = 3_600_000;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "24 hours", "1 hour". */
export function hoursText(hours: number): string {
  return plural(hours, "hour");
}

/**
 * Can a member still cancel this PT session themselves? The same comparison
 * the server makes — at or before `start − window` is in time — so the button
 * never offers a cancel the server will refuse.
 */
export function canStillCancel(
  startsAt: string | Date,
  windowHours: number,
  now: number = Date.now(),
): boolean {
  return now <= new Date(startsAt).getTime() - windowHours * HOUR_MS;
}

/** Can a member still cancel this class? Until it starts, late or not. */
export function canCancelClass(startsAt: string | Date, now: number = Date.now()): boolean {
  return now < new Date(startsAt).getTime();
}

/** Is a cancel now inside the class's window — a late cancellation? */
export function isLate(cancelDeadline: string | Date, now: number = Date.now()): boolean {
  return now > new Date(cancelDeadline).getTime();
}

/** Does the studio limit how many cancellations return the credit? */
function capped(policy: CancellationPolicy): boolean {
  return policy.cancel_cap_enabled;
}

/** "3 cancellations every 30 days", "1 cancellation every day". */
export function capText(policy: CancellationPolicy): string {
  const cycle =
    policy.cancel_cap_cycle_days === 1
      ? "day"
      : `${policy.cancel_cap_cycle_days} days`;
  return `${plural(policy.cancel_cap_count, "cancellation")} every ${cycle}`;
}

/** How late a member may cancel, as the end of a sentence about `what`. */
function deadline(windowHours: number, what: string): string {
  return windowHours === 0
    ? `any time before ${what} starts`
    : `up to ${hoursText(windowHours)} before ${what} starts`;
}

/** Whether a credit or session comes back, for one that `thing` names. */
function comesBack(policy: CancellationPolicy, thing: string): string {
  if (!capped(policy)) return `You'll get your ${thing} back.`;
  if (policy.cancel_cap_count === 0) {
    return `Cancelling doesn't return your ${thing}.`;
  }
  return (
    `You'll get your ${thing} back if you haven't used up your cancellations this cycle ` +
    `(${capText(policy)}). Otherwise you lose the ${thing}.`
  );
}

/** " It counts toward your 3 cancellations every 30 days." — or nothing, with no cap. */
function countsToward(policy: CancellationPolicy | null, still = false): string {
  if (!policy || !capped(policy) || policy.cancel_cap_count === 0) return "";
  return ` It ${still ? "still " : ""}counts toward your ${capText(policy)}.`;
}

/**
 * Stated where a member books a class, before they do. `windowHours` is that
 * class's own Cancellation Window (`effective_cancel_window_hours`); left out,
 * the sentence is about the studio's.
 */
export function classBookingPolicy(
  policy: CancellationPolicy,
  windowHours: number = policy.class_window_hours,
): string {
  if (capped(policy) && policy.cancel_cap_count === 0) {
    return "You can cancel a class any time before it starts. Cancelling doesn't return the credit.";
  }
  const when = `Cancel a class ${deadline(windowHours, "it")} and your credit comes back`;
  const inTime = capped(policy)
    ? `${when}, for up to ${capText(policy)}; after that, cancelling doesn't return it.`
    : `${when}.`;
  // With no window there is no "later": every cancel before the start is in time.
  if (windowHours === 0) return inTime;
  return `${inTime} Cancelling later is a late cancellation: allowed until the class starts, but the credit isn't returned.`;
}

/**
 * The same rule as `classBookingPolicy`, cut into short lines for the
 * schedule's policy notice: one fact per line, each readable at a glance.
 */
export function classPolicyPoints(
  policy: CancellationPolicy,
  windowHours: number = policy.class_window_hours,
): string[] {
  if (capped(policy) && policy.cancel_cap_count === 0) {
    return ["Cancel any time before class starts.", "Cancelled credits aren't returned."];
  }
  const points = [
    windowHours === 0
      ? "Cancel any time before class starts to get your credit back."
      : `Cancel at least ${hoursText(windowHours)} before class to get your credit back.`,
  ];
  if (capped(policy)) {
    const cycle = policy.cancel_cap_cycle_days === 1 ? "day" : `${policy.cancel_cap_cycle_days} days`;
    points.push(
      `Limit: ${plural(policy.cancel_cap_count, "cancellation")} per ${cycle}. Go over it and the credit isn't returned, even in time.`,
    );
  }
  if (windowHours > 0) points.push("Cancel later and the credit isn't returned.");
  return points;
}

/** The warning before a member confirms a late cancel of a class they paid a credit for. */
export const LATE_CANCEL_LINE = "This is a late cancellation — your credit won't be returned.";

/**
 * One class's Cancellation Window, alone — the class detail's line, where the
 * studio's cap is not the point. "Cancel up to 12 hours before it starts."
 */
export function classCancelWindowLine(windowHours: number): string {
  return `Cancel ${deadline(windowHours, "it")}.`;
}

/**
 * The class cancel dialog: what this cancellation will cost the member.
 *
 * `preview` is the server's own answer for this booking, cap and window
 * included; without it (still loading, or the read failed) the dialog states
 * the whole rule instead, for `windowHours` — that class's window.
 */
export function classCancelNotice(
  policy: CancellationPolicy | null,
  wasUnlimited: boolean,
  preview: CancelPreview | null = null,
  windowHours: number | null = null,
): string {
  if (preview?.unlimited || (!preview && wasUnlimited)) {
    const late = preview?.late ? "This is a late cancellation. " : "";
    return `${late}This frees your place. Your Unlimited Plan wasn't charged for this class, so there's nothing to return.${countsToward(policy, true)}`;
  }
  if (preview) {
    if (preview.late) return LATE_CANCEL_LINE;
    if (preview.credit_back) {
      return `You'll get your ${plural(preview.credits, "credit")} back.${countsToward(policy)}`;
    }
    // In time and nothing back: over the cap, or a cap of none.
    if (policy && policy.cancel_cap_count === 0) return "Cancelling doesn't return your credit.";
    return policy
      ? `You've used up your cancellations this cycle (${capText(policy)}), so your credit won't be returned.`
      : "You've used up your cancellations this cycle, so your credit won't be returned.";
  }
  if (!policy) {
    return "Whether your credit comes back depends on the studio's cancellation policy.";
  }
  return classBookingPolicy(policy, windowHours ?? policy.class_window_hours);
}

/** After a class cancel succeeds: did the credit come back, and if not, why? */
export function classCancelResult(
  outcome: string,
  credits: number,
  late: boolean,
): { tone: "ok" | "warn"; text: string } {
  if (outcome === "credit_returned") {
    const n = credits || 1;
    return { tone: "ok", text: `Booking cancelled · ${plural(n, "credit")} returned.` };
  }
  if (outcome === "forfeited") {
    return {
      tone: "warn",
      text: late
        ? "Booking cancelled · a late cancellation, so the credit wasn't returned."
        : "Booking cancelled · the credit wasn't returned, because you've used up your cancellations this cycle.",
    };
  }
  return { tone: "ok", text: "Booking cancelled." };
}

/**
 * The line on an upcoming booking: until when a cancel is in time, or that it
 * no longer is. `when` is the deadline as the page formats times.
 */
export function cancelDeadlineLine(late: boolean, when: string): string {
  return late ? "Cancelling now is a late cancellation." : `Cancel by ${when} to avoid a late cancellation.`;
}

/** The line shown instead of "Cancel" once a PT session is inside its window. */
export function cancelClosed(windowHours: number): string {
  return `Cancellation closed · within ${hoursText(windowHours)} of start`;
}

/** The server refused a PT cancel because the window had passed. */
export function windowRefusal(kind: "class" | "session", windowHours: number): string {
  return (
    `This ${kind} starts within ${hoursText(windowHours)}, so it can no longer be ` +
    `cancelled in the app. Please contact the studio.`
  );
}

/** The PT cancel prompt, for a request still pending or a session already scheduled. */
export function ptCancelPrompt(
  status: "pending" | "scheduled",
  policy: CancellationPolicy | null,
): string {
  if (status === "pending") {
    return "Cancel this request? The sessions it held come back to your package.";
  }
  if (!policy) {
    return "Cancel this session? Whether it comes back depends on the studio's cancellation policy.";
  }
  return `Cancel this session? ${comesBack(policy, "session")}`;
}

/** The footnote under the PT list: the whole rule, once. */
export function ptPolicyNote(policy: CancellationPolicy | null): string {
  const pending = "A pending request always returns its sessions when you cancel it.";
  if (!policy) {
    return `${pending} A scheduled session follows the studio's cancellation policy.`;
  }
  const when = `A scheduled session can be cancelled ${deadline(policy.pt_window_hours, "it")}; after that, please contact the studio.`;
  const back = !capped(policy)
    ? "Its session comes back."
    : policy.cancel_cap_count === 0
      ? "Cancelling a scheduled session doesn't return it."
      : `Its session comes back for up to ${capText(policy)}; after that, a cancelled session is lost.`;
  return `${pending} ${when} ${back}`;
}

/** After a PT cancel succeeds: did the session come back? */
export function ptCancelResult(
  outcome: "session_returned" | "forfeited" | "n_a",
  sessions: number,
): { tone: "ok" | "warn"; text: string } {
  if (outcome === "session_returned") {
    return {
      tone: "ok",
      text: `Cancelled · ${plural(sessions, "session")} returned to your package.`,
    };
  }
  if (outcome === "forfeited") {
    return {
      tone: "warn",
      text: "Cancelled · the session wasn't returned, because you've used up your cancellations this cycle.",
    };
  }
  return { tone: "ok", text: "Cancelled." };
}
