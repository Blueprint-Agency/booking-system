/**
 * The Updates that tell an instructor their session changed under them (#476,
 * #493): `session_changed`, `session_cancelled_by_admin` and
 * `pt_session_cancelled_by_member`. Payload shapes and wording only; the writes
 * are in ./session-updates, and this file imports nothing so `updates.ts` can
 * take the composers without a cycle.
 */

export type SessionKind = 'class' | 'pt' | 'workshop'

interface SessionPayload {
  sessionKind: SessionKind
  sessionId: string
  /** What the sentence calls it: "Vinyasa", "the private session with Jo", "Sunday intensive". */
  subject: string
  /** The session's time as the sentence writes it, in the studio's zone: "Tue 28 Oct, 7:00 pm". */
  when: string
  /** The session's day in the studio's zone, "2026-10-28": where a link goes if there is no session page. */
  date: string
}

export interface SessionChangedPayload extends SessionPayload {
  actorName: string
  /**
   * moved: the start time changed. changed: only the end time, room or location did.
   * handed_over: the recipient was the main instructor and someone else now is.
   * removed: the recipient was taken off. instructor_changed: the main instructor
   * changed and the recipient stays on.
   */
  change: 'moved' | 'changed' | 'handed_over' | 'removed' | 'instructor_changed'
  /** The time it moved from, for `moved`. */
  from: string | null
  /** The main instructor's name now, for `handed_over` and `instructor_changed`. */
  otherInstructor: string | null
}

export interface SessionCancelledByAdminPayload extends SessionPayload {
  actorName: string
}

export interface PtSessionCancelledByMemberPayload extends SessionPayload {
  memberName: string
}

/** The session page, or for a workshop (which has none for an instructor) the schedule on its day. */
export function sessionHref(p: SessionPayload): string {
  if (p.sessionKind === 'class') return `/instructor/schedule/class/${p.sessionId}`
  if (p.sessionKind === 'pt') return `/instructor/schedule/pt/${p.sessionId}`
  return `/instructor/schedule?date=${p.date}`
}

interface Copy {
  title: string
  detail: string | null
  href: string | null
}

export function composeSessionChanged(p: SessionChangedPayload): Copy {
  const onDate = `/instructor/schedule?date=${p.date}`
  switch (p.change) {
    case 'moved':
      return { title: `${p.actorName} moved ${p.subject} from ${p.from} to ${p.when}`, detail: null, href: sessionHref(p) }
    case 'changed':
      return {
        title: `${p.actorName} changed the room, location or end time of ${p.subject} on ${p.when}`,
        detail: null,
        href: sessionHref(p),
      }
    case 'handed_over':
      return {
        title: `${p.actorName} gave ${p.subject} on ${p.when} to ${p.otherInstructor}`,
        detail: null,
        href: onDate,
      }
    case 'removed':
      return { title: `${p.actorName} took you off ${p.subject} on ${p.when}`, detail: null, href: onDate }
    case 'instructor_changed':
      return {
        title: `${p.actorName} changed the instructor of ${p.subject} on ${p.when} to ${p.otherInstructor}`,
        detail: null,
        href: sessionHref(p),
      }
  }
}

export function composeSessionCancelledByAdmin(p: SessionCancelledByAdminPayload): Copy {
  return {
    title: `${p.actorName} cancelled ${p.subject} on ${p.when}, which you were teaching`,
    detail: null,
    href: sessionHref(p),
  }
}

export function composePtSessionCancelledByMember(p: PtSessionCancelledByMemberPayload): Copy {
  return {
    title: `${p.memberName} cancelled their private session with you on ${p.when}`,
    detail: null,
    href: `/instructor/schedule/pt/${p.sessionId}`,
  }
}
