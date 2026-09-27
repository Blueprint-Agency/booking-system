/**
 * The PT request's package picker: which of the member's PT packages can pay
 * for this request, and in words why the rest cannot. The class Book sheet's
 * picker reads its reasons from the server (`lib/package-picker.ts`); a PT
 * request has only two rules, both in what `/me/packages` already carries —
 * the session type and the sessions left — so they are stated here. The server
 * still refuses a package that cannot pay (`insufficient_pt_credit`).
 */
import { formatExpiryDate } from "./utils.ts";

/** The fields of a live package the picker reads (`LivePackage` in `use-client-packages`). */
export interface PtPickable {
  id: string;
  kind: string;
  name: string;
  creditsOrSessionsRemaining: number | null;
  expiresAt: string | null;
  dormant: boolean;
  sessionType: "1on1" | "2on1" | null;
  boundInstructor: { id: string; name: string } | null;
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

/** Every PT package of the request's session type, each ticked or with its reason. */
export function ptPickRows<P extends PtPickable>(
  packages: readonly P[],
  sessionType: "1on1" | "2on1",
  cost: number,
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
      const eligible = left >= cost;
      return {
        pkg,
        eligible,
        reason: eligible ? null : `Only ${sessionsWord(left)} left — this request needs ${cost}`,
        meta,
      };
    });
}

/** The package ticked when the sheet opens: the first that can pay, as the form always chose. */
export function initialPtPick(rows: readonly PtPickRow[]): string | null {
  return rows.find((r) => r.eligible)?.pkg.id ?? null;
}
