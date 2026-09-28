// One body, one session at a time (be/src/services/bookings/member-time.ts).
//
// Booking a member onto a class, putting them in its line, or scheduling their
// private session at a time they are already booked for is refused
// `409 time_clash`, naming the member and what they hold. Staff — an admin or
// an instructor — may go ahead once warned: the same request again with
// `allow_clash: true`, which the backend records on the audit trail. This file
// words the warning and runs that ask-then-retry; the backend decides.

import { ApiError } from "@/lib/api";

/** What a `time_clash` refusal carries. */
export interface TimeClash {
  clientId: string | null;
  clientName: string | null;
  clash: {
    booking_id: string;
    kind: "class" | "pt" | "workshop";
    title: string;
    starts_at: string;
    ends_at: string;
    location_name: string | null;
  };
}

/** What the member would be booked into: the noun the warning ends on. */
export type ClashNoun = "class" | "session";

/** The refusal's clash, or null when `err` is anything else. */
export function timeClashOf(err: unknown): TimeClash | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as {
    error?: string;
    client_id?: string | null;
    client_name?: string | null;
    clash?: TimeClash["clash"];
  } | null;
  if (body?.error !== "time_clash" || !body.clash) return null;
  return { clientId: body.client_id ?? null, clientName: body.client_name ?? null, clash: body.clash };
}

/** "4:00 pm", in the studio's time. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });
}

/** "Inversion at 4:00 pm (Riverside)", or "a private session at …". */
function held(c: TimeClash["clash"]): string {
  const what = c.kind === "pt" ? "a private session" : c.title;
  const place = c.location_name ? ` (${c.location_name})` : "";
  return `${what} at ${clock(c.starts_at)}${place}`;
}

/** The warning staff confirm before booking anyway. */
export function timeClashPrompt(t: TimeClash, noun: ClashNoun): string {
  const who = t.clientName || "This member";
  return `${who} is already booked into ${held(t.clash)}, which overlaps this ${noun}. Book anyway?`;
}

/** What staff read when they chose not to book anyway. */
export function timeClashRefusal(t: TimeClash): string {
  const who = t.clientName || "This member";
  return `Not booked: ${who} is already booked into ${held(t.clash)} at the same time.`;
}

/**
 * Run a staff request; if it is refused `time_clash`, ask staff and, on yes,
 * run it again with `allow_clash: true` merged into its body. On no, the
 * refusal is thrown on as it came, for the caller's own error handling —
 * `timeClashRefusal` words it.
 */
export async function withClashConfirm<T>(
  noun: ClashNoun,
  run: (extra: { allow_clash?: true }) => Promise<T>,
  ask: (message: string) => boolean = (m) => window.confirm(m),
): Promise<T> {
  try {
    return await run({});
  } catch (err) {
    const t = timeClashOf(err);
    if (!t || !ask(timeClashPrompt(t, noun))) throw err;
    return run({ allow_clash: true });
  }
}
