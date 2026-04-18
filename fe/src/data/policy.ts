// Single source of truth for cancellation-window copy. Import from here.
// Keep the numeric hours and the human-readable copy in sync.

export const CLASS_CANCELLATION_HOURS = 12;
export const PRIVATE_SESSION_CANCELLATION_HOURS = 12;

export const CLASS_CANCELLATION_POLICY = {
  window: `${CLASS_CANCELLATION_HOURS} hours`,
  beforeShort: `Cancel more than ${CLASS_CANCELLATION_HOURS} hours before class — full credit refund.`,
  withinShort: `Cancel within ${CLASS_CANCELLATION_HOURS} hours — no credit refund.`,
  repeat: "Repeated last-minute cancellations for the same class may result in a booking restriction.",
  faqShort: `Cancel more than ${CLASS_CANCELLATION_HOURS} hours before class with no penalty. Later cancellations forfeit the credit.`,
} as const;

export const PRIVATE_SESSION_CANCELLATION_POLICY = {
  window: `${PRIVATE_SESSION_CANCELLATION_HOURS} hours`,
  rescheduleNote: `Reschedule or cancel more than ${PRIVATE_SESSION_CANCELLATION_HOURS} hours in advance at no charge. Cancellations within ${PRIVATE_SESSION_CANCELLATION_HOURS} hours forfeit the session credit.`,
  sla: `${PRIVATE_SESSION_CANCELLATION_HOURS} hours`,
} as const;
