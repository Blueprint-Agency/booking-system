import { ERROR_CODES } from "./error-codes";

/**
 * Why a Refund was refused, in words an admin can act on (#293).
 *
 * Two refusals are about where the money is rather than about the purchase:
 * the studio has no payment account of its own any more, so nothing can be
 * returned through the app; or the payment was taken on the platform's former
 * account, which the app holds no key for and which has to be refunded from the
 * Stripe dashboard instead. Both read as "Refund failed (HTTP 409)" otherwise,
 * which tells an admin nothing about what to do next.
 *
 * Pure, so it is testable without a browser.
 */
export const REFUND_REFUSALS: Record<string, string> = {
  [ERROR_CODES.payments_not_configured]:
    "This studio isn't taking online payments yet, so nothing can be refunded through the app.",
  [ERROR_CODES.payment_on_platform_account]:
    "This payment was taken before the studio had its own Stripe account, so it can't be refunded here. Refund it from the Stripe dashboard.",
};

/** The refusal's sentence, or `fallback` for a refusal this does not know. */
export function refundRefusal(body: unknown, fallback: string): string {
  const code =
    body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : "";
  return REFUND_REFUSALS[code] ?? fallback;
}
