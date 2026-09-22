/**
 * The platform's half of every message's identity — see `./mailer.ts`.
 *
 * Its own module, with no imports, so pure code (the email layout, the copy,
 * the sample renderer) can name the platform without importing the mailer,
 * which parses the whole backend env at import.
 */
export const PLATFORM_MAIL_FROM_EMAIL = 'noreply@reservetoday.app'
/** Shown only when no studio name applies — and on super portal mail. */
export const PLATFORM_MAIL_FROM_NAME = 'ReserveToday'
