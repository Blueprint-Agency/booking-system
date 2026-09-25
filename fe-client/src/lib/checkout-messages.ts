import { ERROR_CODES, type ErrorCode } from "./error-codes.ts";
import { NO_ONLINE_PAYMENTS } from "./online-payments-rule.ts";

/**
 * A refused checkout, in words (#274).
 *
 * The backend writes the sentence itself where only it can — a Part Payment
 * amount checked against a balance it owns — and sends it as `message`. Every
 * other refusal arrives as a bare code, and printing that code is how a member
 * came to read `workshop_full` under the buy button. So: the server's sentence
 * first, then ours for a code we know, then the caller's fallback. Never the
 * code.
 *
 * Pure, so it is testable without a browser.
 */
export type CheckoutErrorBody = { error?: string; message?: string } | null | undefined;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ERROR_CODES.workshop_full]: "This workshop is full.",
  [ERROR_CODES.already_booked]: "You're already booked on this workshop.",
  [ERROR_CODES.workshop_not_active]: "This workshop is no longer open for booking.",
  [ERROR_CODES.workshop_cancelled]: "This workshop has been cancelled.",
  [ERROR_CODES.workshop_not_found]: "We couldn't find this workshop. It may have been removed.",
  [ERROR_CODES.workshop_tier_not_found]: "That option isn't available any more. Pick another one.",
  [ERROR_CODES.class_package_not_found]: "We couldn't find this package. It may have been removed.",
  [ERROR_CODES.pt_package_not_found]: "We couldn't find this package. It may have been removed.",
  [ERROR_CODES.class_package_not_active]: "This package isn't on sale any more.",
  [ERROR_CODES.pt_package_not_active]: "This package isn't on sale any more.",
  [ERROR_CODES.package_archived]: "This package isn't on sale any more.",
  [ERROR_CODES.trial_already_used]: "You've already used your trial.",
  [ERROR_CODES.trial_not_eligible]: "The trial is for new members only.",
  [ERROR_CODES.unlimited_limit_reached]:
    "You already have an unlimited plan and a renewal waiting. You can buy another once one of them ends.",
  [ERROR_CODES.unlimited_renewal_location_mismatch]:
    "A renewal has to be at the same home studio as your current plan. Contact the studio to move it.",
  [ERROR_CODES.unlimited_requires_location]: "Choose your home studio to continue.",
  [ERROR_CODES.location_required]: "Choose your home studio to continue.",
  [ERROR_CODES.location_not_found]: "That studio isn't available. Choose another one.",
  [ERROR_CODES.pt_bound_requires_instructor]: "Choose your instructor to continue.",
  [ERROR_CODES.instructor_required]: "Choose your instructor to continue.",
  [ERROR_CODES.merch_not_available]: "This item isn't on sale any more.",
  [ERROR_CODES.merch_not_found]: "This item isn't on sale any more.",
  [ERROR_CODES.checkout_session_busy]:
    "A payment for this is already in progress. Give it a minute, then try again.",
  [ERROR_CODES.purchase_not_open]: "This purchase isn't waiting on a payment any more.",
  [ERROR_CODES.purchase_settled]: "This purchase is already paid in full.",
  [ERROR_CODES.purchase_not_found]: "We couldn't find this purchase.",
  [ERROR_CODES.part_payment_unavailable]: "This studio doesn't take part payments. Pay the whole amount instead.",
  [ERROR_CODES.part_payment_invalid]: "Enter a valid amount to pay now.",
  [ERROR_CODES.part_payment_below_floor]: "That amount is below the smallest part payment.",
  [ERROR_CODES.part_payment_exceeds_balance]: "That's more than you owe. Enter a smaller amount.",
  [ERROR_CODES.part_payment_remainder_too_small]:
    "That would leave too little to pay by card later. Pay the whole amount instead.",
  [ERROR_CODES.cross_location_already_added]: "This plan already covers every location.",
  [ERROR_CODES.cross_location_plan_not_live]: "The add-on needs a current unlimited plan to attach to.",
  [ERROR_CODES.cross_location_requires_unlimited]: "The add-on is only for unlimited plans.",
  [ERROR_CODES.cross_location_nothing_to_charge]: "Your plan has no time left to add other locations to.",
  [ERROR_CODES.client_package_not_found]: "We couldn't find that plan on your account.",
  [ERROR_CODES.promo_code_invalid]: "That code can't be used on this purchase.",
  [ERROR_CODES.payments_not_configured]: NO_ONLINE_PAYMENTS,
  [ERROR_CODES.vendor_timeout]: "The payment service didn't answer in time. Please try again.",
  [ERROR_CODES.rate_limited]: "Too many attempts. Wait a minute, then try again.",
  [ERROR_CODES.too_many_requests]: "Too many attempts. Wait a minute, then try again.",
};

/** Looks like a code rather than a sentence — `workshop_full`, not "It's full." */
const isCode = (text: string) => /^[a-z0-9_]+$/.test(text);

export function checkoutErrorMessage(body: CheckoutErrorBody, fallback: string): string {
  if (!body) return fallback;
  const sentence = body.message?.trim();
  if (sentence && !isCode(sentence)) return sentence;
  const code = body.error ?? sentence;
  return (code && MESSAGES[code as ErrorCode]) || fallback;
}
