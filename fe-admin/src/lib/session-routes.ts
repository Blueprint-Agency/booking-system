import type { Session } from "@/types";

/** Pick the right admin pillar detail route for a given session. */
export function sessionDetailHref(session: Pick<Session, "id" | "type">): string {
  switch (session.type) {
    case "workshop":
      return `/workshops/${session.id}`;
    case "private":
      return `/private-sessions/upcoming/${session.id}`;
    case "regular":
    default:
      return `/classes/schedule/${session.id}`;
  }
}
