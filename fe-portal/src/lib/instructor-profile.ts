import { ApiError } from "./api";
import { permissionRefusal } from "./access-refusal";

export const BIO_MAX = 2000;
export const PHONE_MAX = 40;

export function profileSaveError(err: unknown): string {
  const refused = permissionRefusal(err);
  if (refused) return refused;
  if (!(err instanceof ApiError)) return "Couldn't save";
  const message = (err.body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : `Couldn't save (HTTP ${err.status})`;
}
