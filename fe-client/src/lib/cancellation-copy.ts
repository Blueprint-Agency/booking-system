/**
 * What a member is told about cancelling, worded from the studio's own policy.
 *
 * The rule these sentences describe is the backend's
 * (`be/src/services/policy/evaluate-cancellation.ts`), and it is not the one a
 * member would guess:
 *
 *   - Inside the window a member **cannot** cancel at all — the server refuses.
 *   - Outside it, the credit (or PT session) comes back only while the member
 *     is under the cap on cancellations per cycle. Over it, the cancel still
 *     goes through and the credit is lost.
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
  cancel_cap_count: number;
  cancel_cap_cycle_days: number;
}

const HOUR_MS = 3_600_000;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "24 hours", "1 hour". */
export function hoursText(hours: number): string {
  return plural(hours, "hour");
}

/**
 * Can a member still cancel this themselves? The same comparison the server
 * makes — at or before `start − window` is in time — so the button never
 * offers a cancel the server will refuse.
 */
export function canStillCancel(
  startsAt: string | Date,
  windowHours: number,
  now: number = Date.now(),
): boolean {
  return now <= new Date(startsAt).getTime() - windowHours * HOUR_MS;
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
  if (policy.cancel_cap_count === 0) {
    return `Cancelling doesn't return your ${thing}.`;
  }
  return (
    `You'll get your ${thing} back if you haven't used up your cancellations this cycle ` +
    `(${capText(policy)}). Otherwise you lose the ${thing}.`
  );
}

/** Stated where a member books a class, before they do. */
export function classBookingPolicy(policy: CancellationPolicy): string {
  const when = `You can cancel a class ${deadline(policy.class_window_hours, "it")}.`;
  if (policy.cancel_cap_count === 0) {
    return `${when} Cancelling doesn't return the credit.`;
  }
  return (
    `${when} Your credit comes back for up to ${capText(policy)}; ` +
    `after that, a cancelled class loses its credit.`
  );
}

/** The class cancel dialog: what this cancellation will cost the member. */
export function classCancelNotice(
  policy: CancellationPolicy | null,
  wasUnlimited: boolean,
): string {
  if (wasUnlimited) {
    const counts =
      policy && policy.cancel_cap_count > 0
        ? ` It still counts toward your ${capText(policy)}.`
        : "";
    return `This frees your place. Your Unlimited Plan wasn't charged for this class, so there's nothing to return.${counts}`;
  }
  if (!policy) {
    return "Whether your credit comes back depends on the studio's cancellation policy.";
  }
  return comesBack(policy, "credit");
}

/** The line shown instead of "Cancel" once a class or session is inside the window. */
export function cancelClosed(windowHours: number): string {
  return `Cancellation closed · within ${hoursText(windowHours)} of start`;
}

/** The server refused a cancel because the window had passed. */
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
  const back =
    policy.cancel_cap_count === 0
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
