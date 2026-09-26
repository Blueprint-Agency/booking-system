/**
 * A class's own Cancellation Window on the scheduling forms (#313). Optional:
 * left blank, the class follows the studio's class window from Global Policy,
 * live — the backend resolves it (`be/src/services/policy/cancel-window.ts`).
 */
import type { Api } from "@/lib/api";

/** "Studio default · 24h" — or just "Studio default" before the studio's window is read. */
export function cancelWindowPlaceholder(studioHours: number | null): string {
  return studioHours === null ? "Studio default" : `Studio default · ${studioHours}h`;
}

const INVALID = "The cancellation window must be a whole number of hours, 0 or more.";

/** The field's text as the API takes it: `null` for blank (the studio's), or whole hours from 0. */
export function parseCancelWindow(
  raw: string,
): { ok: true; hours: number | null } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === "") return { ok: true, hours: null };
  if (!/^\d+$/.test(text)) return { ok: false, message: INVALID };
  return { ok: true, hours: Number(text) };
}

/** The reverse of `parseCancelWindow`: a class's own window as the field shows it, blank when it has none. */
export function cancelWindowText(hours: number | null): string {
  return hours === null ? "" : String(hours);
}

/** The studio's class window, as members are told it. Readable by admins and instructors alike. */
export async function fetchStudioClassWindow(api: Api): Promise<number> {
  const res = await api.get<{ class_window_hours: number }>("/public/cancellation-policy");
  return res.class_window_hours;
}
