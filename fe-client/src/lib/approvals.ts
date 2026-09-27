/**
 * The member's approved PT and Corporate Requests they have yet to see
 * (`GET /me/approvals`, be-client.md § approvals.ts). Each is celebrated once,
 * then marked seen.
 */
import type { CalendarEvent } from "./add-to-calendar.ts";

export interface ApiApproval {
  kind: "pt" | "corporate";
  /** The request's id. */
  id: string;
  title: string;
  session_type: "1on1" | "2on1" | null;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  location_address: string | null;
  instructor_name: string | null;
  approved_at: string | null;
}

/** Where the member manages the approved request. */
export function approvalAccountPath(kind: ApiApproval["kind"]): string {
  return kind === "pt" ? "/account/private-sessions" : "/account/corporate";
}

/** What the celebration names it: "Private session (1-on-1)", or the corporate package. */
export function approvalName(a: ApiApproval): string {
  if (a.kind === "corporate") return a.title;
  const type = a.session_type === "2on1" ? "2-on-1" : "1-on-1";
  return a.title === "Private session" ? `Private session (${type})` : `${a.title} · private ${type}`;
}

/** The approved session as a calendar event. */
export function approvalEvent(
  a: ApiApproval,
  studioName: string,
  ctx: { uid: string; accountUrl: string | null },
): CalendarEvent {
  const name = approvalName(a);
  return {
    uid: ctx.uid,
    title: `${name} at ${studioName}`,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    location: a.location_name ? [a.location_name, a.location_address].filter(Boolean).join(", ") : null,
    details: [
      a.instructor_name ? `${name} with ${a.instructor_name}.` : `${name}.`,
      "Arrive a few minutes early to settle in.",
      ctx.accountUrl ? `Manage it: ${ctx.accountUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
