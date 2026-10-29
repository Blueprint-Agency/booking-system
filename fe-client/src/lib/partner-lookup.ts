/**
 * What a partner lookup that threw means for the private session form.
 *
 * The backend refuses a badly formed email with a `400` (`GET
 * /me/pt-sessions/partner-lookup` validates it). That is an answer about the
 * email, one for the member to correct: retrying it cannot help. Anything else
 * (a `5xx`, a dropped connection) is the lookup itself failing, and the studio
 * has not said whether the address is a member, so the member may try again.
 *
 * No `@/` imports, so `node --test` can load it.
 */
export type PartnerLookupFailure = "invalid_email" | "failed";

export function partnerLookupFailure(err: unknown): PartnerLookupFailure {
  const status =
    err && typeof err === "object" && "status" in err ? (err as { status: unknown }).status : null;
  return status === 400 ? "invalid_email" : "failed";
}
