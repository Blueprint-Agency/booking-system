/**
 * The super portal's own mail, rendered.
 *
 * The super portal has no Tenant, so its mail has no studio to speak for: no
 * template row to word it and no studio name to wear. It is platform mail — the
 * platform's name, in the shared design (`services/mail/layout.ts`), in copy
 * that lives here because it belongs to no studio. Sending is
 * `./sign-in-mail.ts`; this half is pure so the sample renderer and tests can
 * reach it without an environment.
 */
import { PLATFORM_MAIL_FROM_NAME } from '../../lib/mailer-identity'
import {
  emailButton,
  emailCode,
  emailHeading,
  emailLink,
  emailNote,
  emailParagraph,
  escapeHtml,
  renderEmail,
  type RenderedEmail,
} from '../mail/layout'

export type PlatformMailSlug = 'platform_two_factor_code' | 'platform_password_reset'

export interface PlatformEmail extends RenderedEmail {
  slug: PlatformMailSlug
  subject: string
}

const REASON = `You're receiving this because this address has a ${PLATFORM_MAIL_FROM_NAME} super portal account.`

function render(slug: PlatformMailSlug, subject: string, bodyHtml: string): PlatformEmail {
  return { slug, subject, ...renderEmail({ brandName: PLATFORM_MAIL_FROM_NAME, subject, bodyHtml, reason: REASON }) }
}

export function platformTwoFactorEmail(name: string, code: string): PlatformEmail {
  return render(
    'platform_two_factor_code',
    `Your ${PLATFORM_MAIL_FROM_NAME} super portal verification code`,
    [
      emailHeading('Your verification code'),
      emailParagraph(`Hi ${escapeHtml(name)},`),
      emailParagraph('Your password was accepted for the super portal. Enter this code to finish signing in:'),
      emailCode(escapeHtml(code)),
      emailNote("The code works once and expires in five minutes. If you didn't just sign in, someone has your password."),
    ].join('\n'),
  )
}

export function platformPasswordResetEmail(name: string, resetUrl: string): PlatformEmail {
  const href = escapeHtml(resetUrl)
  return render(
    'platform_password_reset',
    `Set your ${PLATFORM_MAIL_FROM_NAME} super portal password`,
    [
      emailHeading('Set your super portal password'),
      emailParagraph(`Hi ${escapeHtml(name)},`),
      emailParagraph('Use the button below to choose your super portal password.'),
      emailButton(href, 'Choose a password'),
      emailNote(
        `The link works once and expires in one hour. If you didn't ask for it, ignore this email. If the button doesn't work, paste this into your browser: ${emailLink(href, href)}`,
      ),
    ].join('\n'),
  )
}
