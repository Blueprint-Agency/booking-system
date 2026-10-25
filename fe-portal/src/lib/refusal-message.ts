import { ApiError } from "./api";

/** What a refused save shows: the API's own sentence when it sent one, otherwise the form's fallback. */
export function refusalMessage(err: unknown, fallback: string): string {
  const message = err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
  return typeof message === "string" && message ? message : fallback;
}
