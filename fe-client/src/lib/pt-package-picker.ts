/**
 * The PT request's package picker: which of the member's PT packages can pay
 * for this request, and in words why the rest cannot. The class Book sheet's
 * picker reads its reasons from the server (`lib/package-picker.ts`); a PT
 * request has only three rules, all in what `/me/packages` already carries —
 * the session type, the sessions left, and that every time proposed starts by
 * the package's end — so they are stated here. The server still refuses a
 * package that cannot pay (`insufficient_pt_credit`,
 * `package_expires_before_session`).
 */
import { formatExpiryDate } from "./utils.ts";
import { shortDate } from "./pt-booking-window.ts";

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
  boundInstructor: { id: string; name: string } | null;
}

const SG_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** The instant a proposed slot starts: its Singapore date and `HH:mm`. */
export function ptSlotStart(slot: { proposedDate: string; startTime: string }): number {
  return Date.parse(`${slot.proposedDate}T${slot.startTime}:00Z`) - SG_OFFSET_MS;
}

/**
 * When a PT package runs out: its expiry, or, while it is Dormant, the one it
 * would get if staff scheduled a session now. The server judges every
 * proposed time against the same instant.
 */
export function ptPackageEnd(pkg: Pick<PtPickable, "expiresAt" | "validityDays">, now: number = Date.now()): number | null {
  if (pkg.expiresAt) return Date.parse(pkg.expiresAt);
  return pkg.validityDays === null ? null : now + pkg.validityDays * DAY_MS;
}

/** "9:00 am on Tue 24 Nov", in Singapore time. */
export function ptEndLabel(end: number): string {
  const wall = new Date(end + SG_OFFSET_MS);
  const h = wall.getUTCHours();
  const time = `${h % 12 || 12}:${String(wall.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  return `${time} on ${shortDate(wall.toISOString().slice(0, 10))}`;
}

/** The furthest any of these packages runs, or null when none has an end. */
export function ptLatestEnd(packages: readonly Pick<PtPickable, "expiresAt" | "validityDays">[], now: number = Date.now()): number | null {
  const ends = packages.map((p) => ptPackageEnd(p, now)).filter((e): e is number => e !== null);
  return ends.length ? Math.max(...ends) : null;
}

/**
 * The last date the picker offers, as YYYY-MM-DD: the Book in advance window's
 * last day, or the Singapore day the furthest package ends if that is sooner.
 */
export function ptLatestDate(windowLatest: string | undefined, latestEnd: number | null): string | undefined {
  const endDay = latestEnd === null ? undefined : new Date(latestEnd + SG_OFFSET_MS).toISOString().slice(0, 10);
  if (!windowLatest || !endDay) return windowLatest ?? endDay;
  return endDay < windowLatest ? endDay : windowLatest;
}

/**
 * What is wrong with one proposed time against the furthest any package of
 * the request's type runs, or null. `slot` is 1-based, for the message.
 */
export function ptSlotEndProblem(
  s: { proposedDate: string; startTime: string },
  slot: number,
  latestEnd: number | null,
): string | null {
  if (latestEnd === null || ptSlotStart(s) <= latestEnd) return null;
  return `Time ${slot}: no package of yours runs past ${ptEndLabel(latestEnd)}. Pick a time by then.`;
}

export interface PtPickRow<P extends PtPickable = PtPickable> {
  pkg: P;
  eligible: boolean;
  /** Why it cannot pay; null when it can. */
  reason: string | null;
  /** Its balance and where its clock stands. */
  meta: string;
}

export const sessionTypeLabel = (t: "1on1" | "2on1") => (t === "2on1" ? "2-on-1" : "1-on-1");

export const sessionsWord = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

/**
 * Every PT package of the request's session type, each ticked or with its
 * reason. `latestStart` is the last proposed time: a package that runs out
 * before it cannot pay.
 */
export function ptPickRows<P extends PtPickable>(
  packages: readonly P[],
  sessionType: "1on1" | "2on1",
  cost: number,
  latestStart: number | null = null,
  now: number = Date.now(),
): PtPickRow<P>[] {
  return packages
    .filter((p) => p.kind === "pt" && p.sessionType === sessionType)
    .map((pkg) => {
      const left = pkg.creditsOrSessionsRemaining ?? 0;
      const clock = pkg.dormant
        ? "starts when your first session is scheduled"
        : pkg.expiresAt
          ? `until ${formatExpiryDate(pkg.expiresAt)}`
          : null;
      const meta = clock ? `${sessionsWord(left)} left · ${clock}` : `${sessionsWord(left)} left`;
      const end = ptPackageEnd(pkg, now);
      const reason =
        left < cost
          ? `Only ${sessionsWord(left)} left — this request needs ${cost}`
          : latestStart !== null && end !== null && latestStart > end
            ? `Runs until ${ptEndLabel(end)}, before one of your times`
            : null;
      return { pkg, eligible: reason === null, reason, meta };
    });
}

/** The package ticked when the sheet opens: the first that can pay, as the form always chose. */
export function initialPtPick(rows: readonly PtPickRow[]): string | null {
  return rows.find((r) => r.eligible)?.pkg.id ?? null;
}
