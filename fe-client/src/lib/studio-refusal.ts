/**
 * The studio refusing the member app as a whole, rather than one call (#250).
 *
 *  - **Paused.** The studio is suspended: its slug lookup says so, and every
 *    other call is answered `403 tenant_suspended`. Nothing the member app
 *    would show is true while it lasts, so it shows a paused page instead
 *    (`components/studio-gate.tsx`).
 *  - **Another studio's session.** `403 tenant_mismatch`: the token this
 *    hostname holds was signed in at a different studio. Logins are per studio
 *    (ADR 0006), so the token is forgotten and the member is offered sign-in here.
 *
 * A relay, like `maintenance.ts`: the fetch helpers only notify, and the gate
 * registers what to do. No `@/` imports, so `node --test` can load it.
 */
import { ERROR_CODES } from "./error-codes.ts";

export type StudioRefusal = { kind: "paused" } | { kind: "other-studio"; sentToken?: string };

export function studioRefusal(status: number, body: unknown): StudioRefusal["kind"] | null {
  if (status !== 403 || !body || typeof body !== "object") return null;
  const { error } = body as { error?: unknown };
  if (error === ERROR_CODES.tenant_suspended) return "paused";
  if (error === ERROR_CODES.tenant_mismatch) return "other-studio";
  return null;
}

/** The backend's own rule (`requireActiveTenant`): any status but active is refused. */
export function pausedByStatus(status: string): boolean {
  return status !== "active";
}

type Listener = (refusal: StudioRefusal) => void;

let listener: Listener | null = null;

export function onStudioRefusal(fn: Listener | null): void {
  listener = fn;
}

/**
 * Pass the token the call sent: a refusal that lands after the member signed
 * in again answers for the old one.
 */
export function noteStudioRefusal(status: number, body: unknown, sentToken?: string): boolean {
  const kind = studioRefusal(status, body);
  if (kind === null) return false;
  listener?.(kind === "paused" ? { kind } : { kind, sentToken });
  return true;
}
