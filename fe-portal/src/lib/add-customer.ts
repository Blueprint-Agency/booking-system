import { ApiError } from "./api";

export function addCustomerError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not create customer.";
  const message = (err.body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : `Could not create customer (HTTP ${err.status}).`;
}
