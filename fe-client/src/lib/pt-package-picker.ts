/**
 * The PT request's package picker: which of the member's PT packages can pay
 * for this request, and in words why the rest cannot. The class Book sheet's
 * picker reads its reasons from the server (`lib/package-picker.ts`); a PT
 * request's rules read only what `/me/packages` already carries, so they are
 * stated here. The server still refuses a package that cannot pay.
 */
import { shortDate } from "./pt-booking-window.ts";
import { formatClassTime, formatExpiryDate, instantAt, localDate } from "./studio-time.ts";

/** The fields of a live package the picker reads (`LivePackage` in `use-client-packages`). */
export interface PtPickable {
  id: string;
  kind: string;
  name: string;
  creditsOrSessionsRemaining: number | null;
  expiresAt: string | null;
  dormant: boolean;
  validityDays: number | null;
  sessionType: "1on1" | "2on1" | null;
  /** The Entity the package was sold under; null or absent when it has none. */
  entityId?: string | null;
  boundInstructor: { id: string; name: string } | null;
}

/**
 * Whether a package of `packageEntityId` can pay for a request whose class type
 * is in `classTypeEntityId`: a private session's class type is in its paying
 * package's Entity. Either side with no Entity (an unspecific request, a package
 * from before Entities) rules nothing out, as the server judges it.
 */
export function ptPackageFitsEntity(packageEntityId: string | null | undefined, classTypeEntityId: string | null | undefined): boolean {
  return !packageEntityId || !classTypeEntityId || packageEntityId === classTypeEntityId;
}

/** A proposed time is a wall time at the studio: the date and `HH:MM` the member picked, on its clock. */
export function ptSlotStart(slot: { proposedDate: string; startTime: string }, timezone: string): number {
  return instantAt(timezone, slot.proposedDate, slot.startTime);
}

/** The longest a package may run once Activated: ten years (`MAX_VALIDITY_DAYS` in the server's `validity.ts`). */
const MAX_VALIDITY_DAYS = 3650;
const DAY_MS = 86_400_000;

/**
 * A Dormant package is judged by the end scheduling a session now would give it,
 * as the server judges it (`activationExpiry` in the server's `validity.ts`):
 * `validity_days` of 24 hours each from now, capped at ten years. That is UTC
 * arithmetic, not the studio's calendar, so across a daylight-saving change the
 * end sits an hour off the wall clock the member counts on.
 */
export function ptPackageEnd(pkg: Pick<PtPickable, "expiresAt" | "validityDays">, now: number = Date.now()): number | null {
  if (pkg.expiresAt) return Date.parse(pkg.expiresAt);
  return pkg.validityDays === null ? null : now + Math.min(pkg.validityDays, MAX_VALIDITY_DAYS) * DAY_MS;
}

export function ptEndLabel(end: number, timezone: string): string {
  return `${formatClassTime(timezone, end)} on ${shortDate(localDate(timezone, end))}`;
}

export function ptLatestEnd(
  packages: readonly Pick<PtPickable, "expiresAt" | "validityDays">[],
  now: number = Date.now(),
): number | null {
  const ends = packages.map((p) => ptPackageEnd(p, now)).filter((e): e is number => e !== null);
  return ends.length ? Math.max(...ends) : null;
}

export function ptLatestDate(windowLatest: string | undefined, latestEnd: number | null, timezone: string): string | undefined {
  const endDay = latestEnd === null ? undefined : localDate(timezone, latestEnd);
  if (!windowLatest || !endDay) return windowLatest ?? endDay;
  return endDay < windowLatest ? endDay : windowLatest;
}

export function ptSlotEndProblem(
  s: { proposedDate: string; startTime: string },
  slot: number,
  latestEnd: number | null,
  timezone: string,
): string | null {
  if (latestEnd === null || ptSlotStart(s, timezone) <= latestEnd) return null;
  return `Time ${slot}: no package of yours runs past ${ptEndLabel(latestEnd, timezone)}. Pick a time by then.`;
}

export interface PtPickRow<P extends PtPickable = PtPickable> {
  pkg: P;
  eligible: boolean;
  /** Why it cannot pay; null when it can. */
  reason: string | null;
  /** Its balance and where its clock stands. */
  meta: string;
  /** Ruled out because it is in another Entity than the class type picked. */
  entityMismatch: boolean;
}

export const sessionTypeLabel = (t: "1on1" | "2on1") => (t === "2on1" ? "2-on-1" : "1-on-1");

export const sessionsWord = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

/** Every PT package of the request's session type, each ticked or with its reason. */
export function ptPickRows<P extends PtPickable>(
  packages: readonly P[],
  sessionType: "1on1" | "2on1",
  cost: number,
  timezone: string,
  latestStart: number | null = null,
  now: number = Date.now(),
  /** The Entity of the class type the member picked first; null for "Any" or one with none. */
  classTypeEntityId: string | null = null,
): PtPickRow<P>[] {
  return packages
    .filter((p) => p.kind === "pt" && p.sessionType === sessionType)
    .map((pkg) => {
      const left = pkg.creditsOrSessionsRemaining ?? 0;
      const clock = pkg.dormant
        ? "starts when your first session is scheduled"
        : pkg.expiresAt
          ? `until ${formatExpiryDate(timezone, pkg.expiresAt)}`
          : null;
      const meta = clock ? `${sessionsWord(left)} left · ${clock}` : `${sessionsWord(left)} left`;
      const end = ptPackageEnd(pkg, now);
      const entityMismatch = !ptPackageFitsEntity(pkg.entityId, classTypeEntityId);
      const reason = entityMismatch
        ?"Not for the class type you picked — choose another class type, or Any"
        : left < cost
          ? `Only ${sessionsWord(left)} left — this request needs ${cost}`
          : latestStart !== null && end !== null && latestStart > end
            ? `Runs until ${ptEndLabel(end, timezone)}, before one of your times`
            : null;
      return { pkg, eligible: reason === null, reason, meta, entityMismatch };
    });
}

/** The package ticked when the sheet opens: the first that can pay, as the form always chose. */
export function initialPtPick(rows: readonly PtPickRow[]): string | null {
  return rows.find((r) => r.eligible)?.pkg.id ?? null;
}
