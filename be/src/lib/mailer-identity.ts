/**
 * The platform's half of every message's identity — see `./mailer.ts`.
 *
 * Its own module, with no imports, so pure code (the email layout, the copy,
 * the sample renderer) can name the platform without importing the mailer,
 * which parses the whole backend env at import.
 */
export const PLATFORM_MAIL_FROM_EMAIL = 'noreply@reservetoday.app'
/** Shown when no studio name applies, on super portal mail, and on a studio's mail to its staff. */
export const PLATFORM_MAIL_FROM_NAME = 'ReserveToday'
