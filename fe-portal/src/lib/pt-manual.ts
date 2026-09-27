// A manual private session (#336): one staff put on the Schedule with its
// members, no member request behind it. This module words the member's
// packages for a seat, the warnings staff may accept with Add anyway, and a
// refused create, and builds the create call's body. Shapes mirror
// be/src/routes/portal/pt-manual.ts.

import { ApiError, type Api } from "@/lib/api";
import type { ErrorCode } from "@/lib/error-codes";
import type { PackageOption, StaffRole } from "@/lib/class-seats";
import { formatDate } from "@/lib/formatters";
import { payOrNull } from "@/lib/pay";
import { scheduleErrorMessage } from "@/lib/schedule";

export type PtSessionType = "1on1" | "2on1";

export type SeatRefusal =
  | "not_a_pt_package"
  | "package_expired"
  | "insufficient_pt_credit"
  | "package_not_consumable"
  | "bound_to_other_instructor";

export type SeatWarning = "session_type_mismatch" | "bound_to_other_instructor";

/** One of the member's PT packages read against the session's type and instructor. */
export interface SeatCandidate {
  id: string;
  name: string | null;
  session_type: PtSessionType | null;
  sessions_left: number | null;
  expires_at: string | null;
  bound_instructor: { id: string; name: string } | null;
  /** Can pay, with or without warnings. */
  eligible: boolean;
  reason: SeatRefusal | null;
  warnings: SeatWarning[];
  /** Dormant only: the end date a seat would stamp on it now. */
  activation_end_if_picked: string | null;
}

export interface SeatCandidates {
  /** The Default payer: the first Eligible package, or null when none can pay. */
  default_client_package_id: string | null;
  /** Every PT package the member holds, in Default-payer order. */
  packages: SeatCandidate[];
}

/**
 * The member's packages for a seat on a session of this type. The admin names
 * the session's instructor; the instructor route reads against the caller.
 */
export function fetchSeatCandidates(
  api: Api,
  role: StaffRole,
  input: { clientId: string; sessionType: PtSessionType; instructorId: string },
): Promise<SeatCandidates> {
  return role === "admin"
    ? api.get<SeatCandidates>("/portal/admin/pt-sessions/seat-candidates", {
        client_id: input.clientId,
        session_type: input.sessionType,
        instructor_id: input.instructorId,
      })
    : api.get<SeatCandidates>("/portal/instructor/pt-requests/seat-candidates", {
        client_id: input.clientId,
        session_type: input.sessionType,
      });
}

export function createManualSession(api: Api, role: StaffRole, body: ManualSessionBody): Promise<unknown> {
  return api.post(role === "admin" ? "/portal/admin/pt-sessions/manual" : "/portal/instructor/pt-requests/manual", body);
}

/** How many members a session of this type seats. */
export function seatLimit(type: PtSessionType): number {
  return type === "1on1" ? 1 : 2;
}

export function sessionTypeLabel(type: PtSessionType): string {
  return type === "1on1" ? "1-on-1" : "2-on-1";
}

/* ------------------------------ The package pick ------------------------------ */

/** Why a greyed package can't pay, beside its name in the select. */
const REFUSAL_NOTE: Record<SeatRefusal, string> = {
  not_a_pt_package: "Not a private-session package",
  package_expired: "Expired",
  insufficient_pt_credit: "No sessions left",
  package_not_consumable: "Voided",
  bound_to_other_instructor: "Bound to another instructor",
};

function optionLabel(p: SeatCandidate): string {
  const parts = [p.name ?? "PT package"];
  if (p.sessions_left !== null) parts.push(`${p.sessions_left} ${p.sessions_left === 1 ? "session" : "sessions"} left`);
  if (p.session_type) parts.push(sessionTypeLabel(p.session_type));
  if (p.bound_instructor) parts.push(`bound to ${p.bound_instructor.name}`);
  if (p.expires_at) parts.push(`ends ${formatDate(p.expires_at, "d MMM yyyy")}`);
  return parts.join(" · ");
}

export interface SeatChoice {
  options: PackageOption[];
  /** What pays when staff leave it alone; null when nothing can. */
  defaultId: string | null;
  /** More than one package can pay, so staff pick, as the member would. */
  choosable: boolean;
  /** Why the member can't be seated at all; null when a package can pay. */
  refusal: string | null;
}

/**
 * The member's packages as the roster row offers them: a select only when more
 * than one can pay, Ineligible ones listed greyed with their reason so staff
 * can tell the member why, and a Dormant one saying when it would run until.
 */
export function seatChoice(res: SeatCandidates): SeatChoice {
  const eligible = res.packages.filter((p) => p.eligible);
  const defaultId = res.default_client_package_id ?? eligible[0]?.id ?? null;
  return {
    defaultId,
    choosable: eligible.length > 1,
    refusal:
      res.packages.length === 0
        ? "This member holds no PT package."
        : defaultId === null
          ? "This member has no PT package that can pay for this session."
          : null,
    options: res.packages.map((p) => ({
      id: p.id,
      label: optionLabel(p),
      disabled: !p.eligible,
      note: !p.eligible
        ? p.reason
          ? REFUSAL_NOTE[p.reason]
          : "Can't pay for this session"
        : p.activation_end_if_picked
          ? `Starts today, runs until ${formatDate(p.activation_end_if_picked, "d MMM yyyy")}`
          : null,
    })),
  };
}

/**
 * What charging this package bends, one sentence per warning. Staff accept
 * them with Add anyway; an Instructor is never warned of a binding, because
 * for them it is a refusal and the package is Ineligible.
 */
export function seatWarnings(p: SeatCandidate, sessionType: PtSessionType): string[] {
  return p.warnings.map((w) =>
    w === "session_type_mismatch"
      ? `This is a ${p.session_type ? sessionTypeLabel(p.session_type) : "different"} package on a ${sessionTypeLabel(sessionType)} session.`
      : `This package is bound to ${p.bound_instructor?.name ?? "another instructor"}.`,
  );
}

/* ---------------------------------- Saving ---------------------------------- */

/** One member row as the form holds it. */
export interface ManualSeat {
  clientId: string;
  name: string;
  /** The package that pays; null when none can. */
  packageId: string | null;
  /** The chosen package carries warnings. */
  warned: boolean;
  /** Staff said Add anyway to them. */
  accepted: boolean;
  /** The member's packages have been read for the session's current shape. */
  ready: boolean;
  /** Why the member couldn't be read at all (blocked, gone); null otherwise. */
  readError: string | null;
}

export interface ManualSessionFields {
  sessionType: PtSessionType;
  instructorId: string;
  locationId: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** The pay field's text; ignored on the instructor route. */
  pay: string;
}

export interface ManualSessionBody {
  session_type: PtSessionType;
  instructor_id?: string;
  location_id: string;
  room_id: string;
  starts_at: string;
  ends_at: string;
  instructor_pay_sgd?: number | null;
  members: { client_id: string; client_package_id: string }[];
  override?: true;
}

/**
 * The create call's body, or the sentence saying what stops the save. An
 * instructor names no instructor (the route runs it as them) and no pay (an
 * admin prices it), as on their class form. `override` goes only when staff
 * accepted a warning, and a warned row not accepted stops the save, so the
 * flag never covers a warning nobody saw.
 */
export function manualSessionBody(
  f: ManualSessionFields,
  seats: ManualSeat[],
  role: StaffRole,
): ManualSessionBody | string {
  if (!f.locationId || !f.roomId) return "Pick a location and room.";
  if (role === "admin" && !f.instructorId) return "Pick an instructor.";
  if (!f.date) return "Pick a date.";
  const startsAt = new Date(`${f.date}T${f.startTime}:00`);
  const endsAt = new Date(`${f.date}T${f.endTime}:00`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "Pick a valid date and time.";
  if (endsAt <= startsAt) return "End time must be after start time.";
  const pay = role === "admin" ? payOrNull(f.pay) : null;
  if (pay !== null && (Number.isNaN(pay) || pay < 0)) return "Instructor pay can't be negative.";

  if (seats.length === 0) return "Add at least one member.";
  if (seats.length > seatLimit(f.sessionType)) {
    return f.sessionType === "1on1"
      ? "A 1-on-1 takes one member. Remove one, or make it a 2-on-1."
      : "A 2-on-1 takes two members at most.";
  }
  const members: ManualSessionBody["members"] = [];
  for (const s of seats) {
    const problem = seatProblem(s, " Remove them to save.");
    if (problem) return problem;
    members.push({ client_id: s.clientId, client_package_id: s.packageId! });
  }

  return {
    session_type: f.sessionType,
    ...(role === "admin" ? { instructor_id: f.instructorId, instructor_pay_sgd: pay } : {}),
    location_id: f.locationId,
    room_id: f.roomId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    members,
    ...(seats.some((s) => s.warned && s.accepted) ? { override: true as const } : {}),
  };
}

/**
 * Why this member can't be seated yet, or null when their package is settled.
 * `remedy` ends the sentences staff can act on by taking the member off.
 */
function seatProblem(s: ManualSeat, remedy = ""): string | null {
  if (s.readError) return `${s.name} can't be added: ${s.readError}${remedy}`;
  if (!s.ready) return `Still reading ${s.name}'s packages.`;
  if (!s.packageId) return `${s.name} has no package that can pay.${remedy}`;
  if (s.warned && !s.accepted) return `${s.name}'s package needs Add anyway, or pick another.`;
  return null;
}

/* ------------------------ After it exists (#338) ------------------------ */

/** A private session as its detail page holds it, enough to judge what staff may do. */
export interface ManualSessionState {
  origin: "member" | "portal" | null;
  lifecycle: "active" | "cancelled";
  session_type: PtSessionType;
  clients: { id: string; name: string; is_requester: boolean }[];
}

/** Staff put it on the Schedule with no member request behind it. */
export function isManual(s: Pick<ManualSessionState, "origin">): boolean {
  return s.origin === "portal";
}

/** A manual session still on, with a seat its type holds and nobody fills. */
export function canAddMember(s: ManualSessionState): boolean {
  return isManual(s) && s.lifecycle === "active" && s.clients.length < seatLimit(s.session_type);
}

/** What staff are asked before cancelling the whole session. */
export function ptCancelConfirm(s: Pick<ManualSessionState, "origin">): string {
  return isManual(s)
    ? "Cancel this private session? Each member gets their session back on the package it was paid from."
    : "Cancel this private session? Customer bookings will be cancelled and credits returned.";
}

export interface AddMemberBody {
  client_id: string;
  client_package_id: string;
  override?: true;
}

/** The add-member call's body, or the sentence saying what stops it. */
export function addMemberBody(s: ManualSeat): AddMemberBody | string {
  const problem = seatProblem(s);
  if (problem) return problem;
  return {
    client_id: s.clientId,
    client_package_id: s.packageId!,
    ...(s.warned && s.accepted ? { override: true as const } : {}),
  };
}

/**
 * Who a downgrade to 1-on-1 takes off: everyone but the request's client, as
 * the backend keeps them (or, with none, whoever booked first).
 */
export function downgradeLeaving<T extends { is_requester: boolean }>(clients: T[]): T[] {
  const keep = clients.find((c) => c.is_requester) ?? clients[0];
  return clients.filter((c) => c !== keep);
}

export function downgradeConfirm(clients: { name: string; is_requester: boolean }[]): string {
  const leaving = downgradeLeaving(clients);
  if (leaving.length === 0) return "Change this session to 1-on-1?";
  const names = leaving.map((c) => c.name).join(" and ");
  return `Change this session to 1-on-1? ${names} ${leaving.length === 1 ? "is" : "are"} taken off it and ${leaving.length === 1 ? "gets their session" : "get their sessions"} back on their own package.`;
}

export interface RetypeBody {
  session_type: PtSessionType;
  co_client_id?: string;
  co_client_package_id?: string;
  override?: true;
}

/**
 * The type change's body (Admin only). A downgrade is the type alone; an
 * upgrade names the partner joining and the package they pay from.
 */
export function retypeBody(to: PtSessionType, partner: ManualSeat | null): RetypeBody | string {
  if (to === "1on1") return { session_type: "1on1" };
  if (!partner) return "Add the partner who joins the 2-on-1.";
  const problem = seatProblem(partner);
  if (problem) return problem;
  return {
    session_type: "2on1",
    co_client_id: partner.clientId,
    co_client_package_id: partner.packageId!,
    ...(partner.warned && partner.accepted ? { override: true as const } : {}),
  };
}

export function addSessionMember(api: Api, role: StaffRole, sessionId: string, body: AddMemberBody): Promise<unknown> {
  return api.post(`${sessionsPath(role)}/${sessionId}/members`, body);
}

export function removeSessionMember(api: Api, role: StaffRole, sessionId: string, clientId: string): Promise<unknown> {
  return api.del(`${sessionsPath(role)}/${sessionId}/members/${clientId}`);
}

export function retypeSession(api: Api, sessionId: string, body: RetypeBody): Promise<unknown> {
  return api.patch(`/portal/admin/pt-sessions/sessions/${sessionId}`, body);
}

/**
 * Cancel a PT request or its session, on the caller's surface, with staff's
 * reason to the member when there is one. It goes against the request, never
 * the session id.
 */
export function cancelSession(
  api: Api,
  role: StaffRole,
  ptRequestId: string,
  note: string | null = null,
): Promise<unknown> {
  return api.post(
    role === "admin" ? `/portal/admin/pt-sessions/${ptRequestId}/cancel` : `/portal/instructor/pt-requests/${ptRequestId}/cancel`,
    { note },
  );
}

function sessionsPath(role: StaffRole): string {
  return role === "admin" ? "/portal/admin/pt-sessions/sessions" : "/portal/instructor/pt-requests/sessions";
}

// A refused remove, add, type change or cancel, in staff terms (#335, #337).
const SESSION_ACTION_COPY: Partial<Record<ErrorCode, string>> = {
  booking_attended: "That member has checked in, so their seat can't be given back.",
  session_ended: "This session has ended, so its members can't change.",
  session_cancelled: "This session has been cancelled.",
  not_your_session: "This session is not one you are teaching.",
  not_a_manual_session: "Only a session staff added manually can change its members.",
  booking_not_found: "That member is no longer on this session.",
  pt_session_not_found: "This session can't be found.",
  pt_request_not_found: "This session's request can't be found.",
  partner_required: "Add the partner who joins the 2-on-1.",
  session_full: "This session has no free seat.",
  cannot_cancel: "This session can no longer be cancelled.",
  not_your_request: "This session is not one you are teaching.",
};

/** A refused action on an existing session; the seat rule's codes read as on create. */
export function sessionActionErrorMessage(err: unknown, fallback: string): string {
  const code = err instanceof ApiError ? errorCode(err) : undefined;
  return (code && (SESSION_ACTION_COPY[code] ?? CREATE_ERROR_COPY[code])) || scheduleErrorMessage(err, fallback);
}

// A refused create, in staff terms. A room or instructor clash is not here: it
// arrives as `schedule_conflict` carrying the specific sentence, which
// `scheduleErrorMessage` passes through, as it does the other scheduling codes.
const CREATE_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  not_a_pt_package: "That package isn't a private-session package.",
  package_expired: "That package has expired.",
  insufficient_pt_credit: "That package has no sessions left.",
  package_not_consumable: "That package has been voided.",
  bound_to_other_instructor: "That package is bound to another instructor. Ask an admin to add this member.",
  seat_needs_override: "A member's package has changed and needs Add anyway. Check the members and save again.",
  session_full: "Too many members for this session type.",
  already_booked: "That member is already on this session.",
  client_not_found: "That member can't be found.",
  client_blocked: "That member's account is blocked.",
  client_package_not_found: "That package can no longer pay for this session.",
};

// Reading a member's packages refuses them as adding them would (#337).
const READ_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  client_not_found: "That member can't be found.",
  client_blocked: "That member's account is blocked.",
};

function errorCode(err: ApiError): ErrorCode | undefined {
  return (err.body as { error?: string } | null)?.error as ErrorCode | undefined;
}

export function manualSessionErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? errorCode(err) : undefined;
  return (code && CREATE_ERROR_COPY[code]) || scheduleErrorMessage(err, "Couldn't create the session");
}

/** Why the member's packages can't be read at all (another studio's, deleted, blocked). */
export function seatReadErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Network error.";
  const code = errorCode(err);
  return (code && READ_ERROR_COPY[code]) || `Couldn't read their packages (HTTP ${err.status}).`;
}
