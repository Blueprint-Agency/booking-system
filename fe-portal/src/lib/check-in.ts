/**
 * The check-in desk (#192): what the backend's check-in surface returns, and
 * the few decisions the page makes on its own — which session to open on, and
 * whether a QR the camera keeps seeing is a new scan.
 *
 * Every rule about WHETHER a booking may be checked in (the Check-in Window,
 * cancelled bookings, an instructor's own sessions) is the backend's. The page
 * shows the server's `message` for a refusal rather than composing its own.
 *
 * Pure: no React, no fetch. See check-in.test.ts.
 */
import { ApiError } from "@/lib/api";

/** Which mount of the surface the page talks to. */
export type CheckInAudience = "admin" | "instructor";

export type CheckInState = "pending" | "attended" | "no_show" | "n_a";
export type CheckInMethod = "qr" | "code" | "manual";

export interface CheckInRosterRow {
  booking_id: string;
  client_id: string;
  name: string;
  code: string;
  state: "confirmed" | "no_show";
  check_in_state: CheckInState;
  method: CheckInMethod | null;
  checked_in_at: string | null;
}

export interface CheckInSession {
  kind: "class" | "pt";
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  check_in_opens_at: string;
  location: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  instructor: { id: string; name: string } | null;
  roster: CheckInRosterRow[];
}

export interface CheckInDay {
  date: string;
  opens_minutes_before: number;
  sessions: CheckInSession[];
}

export interface ScanResult {
  outcome: "checked_in" | "already_checked_in";
  message: string;
  booking_id: string;
  method: CheckInMethod;
  member: { id: string; name: string };
  session: {
    kind: "class" | "pt";
    id: string;
    name: string;
    starts_at: string;
    location: { id: string; name: string } | null;
  };
}

export const checkInBase = (audience: CheckInAudience) => `/portal/${audience}/check-in`;

export const sessionKey = (s: Pick<CheckInSession, "kind" | "id">) => `${s.kind}:${s.id}`;

export type SessionPhase = "not_open" | "open" | "ongoing" | "ended";

/** Where a session stands against the clock, for its badge. */
export function sessionPhase(s: CheckInSession, now: Date): SessionPhase {
  const t = now.getTime();
  if (t >= new Date(s.ends_at).getTime()) return "ended";
  if (t >= new Date(s.starts_at).getTime()) return "ongoing";
  if (t >= new Date(s.check_in_opens_at).getTime()) return "open";
  return "not_open";
}

/**
 * The session the desk opens on: the one running now, else the next to start,
 * else the last of the day. Two running at once (two rooms) → the one that
 * started most recently, since its members are the ones still arriving.
 */
export function pickActiveSession(sessions: CheckInSession[], now: Date): string | null {
  if (sessions.length === 0) return null;
  const t = now.getTime();
  const start = (s: CheckInSession) => new Date(s.starts_at).getTime();
  const end = (s: CheckInSession) => new Date(s.ends_at).getTime();

  const running = sessions.filter((s) => start(s) <= t && t < end(s));
  if (running.length > 0) {
    return sessionKey(running.reduce((a, b) => (start(b) > start(a) ? b : a)));
  }
  const upcoming = sessions.filter((s) => start(s) > t);
  if (upcoming.length > 0) {
    return sessionKey(upcoming.reduce((a, b) => (start(b) < start(a) ? b : a)));
  }
  return sessionKey(sessions.reduce((a, b) => (start(b) > start(a) ? b : a)));
}

/** The server's sentence for a refusal; `fallback` only when it sent none. */
export function checkInErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === "string" && body.message) return body.message;
    return `${fallback} (HTTP ${err.status}).`;
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return `${fallback} — the server took too long to answer.`;
  }
  return `${fallback} — check the connection.`;
}

/** How long the same QR, still held in front of the camera, is not a new scan. */
export const RESCAN_QUIET_MS = 3000;

/**
 * Keeps an always-on camera from submitting one member's QR ten times a
 * second. A different token goes straight through; the same one only once it
 * has been out of the camera's sight for `quietMs`.
 */
export function createScanGate(quietMs = RESCAN_QUIET_MS) {
  let last: { token: string; at: number } | null = null;
  return {
    /** True when `token` should be submitted. Seeing it again extends the quiet. */
    admit(token: string, now: number): boolean {
      if (last && last.token === token && now - last.at < quietMs) {
        last = { token, at: now };
        return false;
      }
      last = { token, at: now };
      return true;
    },
    reset() {
      last = null;
    },
  };
}
