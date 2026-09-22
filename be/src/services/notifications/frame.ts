/**
 * A studio's stored template, rendered and wrapped in the shared email design.
 *
 * The stored `body_html` is the *content* — what the portal's template editor
 * shows and edits, `{{var}}` placeholders and all. The header, the footer and
 * the palette are not the studio's copy; they are the layout's
 * (`services/mail/layout.ts`), applied here at send time, so every studio's
 * mail — and every row written before the design changed — goes out in the
 * same design.
 *
 * Pure: `sendTemplatedEmail` calls it twice (once with the real variables, once
 * with the secrets redacted for `email_log`), and the tests call it for every
 * seeded template without a database.
 */
import { renderEmail, templateBodyFragment, type RenderedEmail } from '../mail/layout'
import { renderTemplate } from './render'

export interface FrameInput {
  slug: string
  recipientKind: 'client' | 'staff'
  /** The studio's display name — `tenantMailIdentity().fromName`. Plain text. */
  studioName: string
  /** The stored template, unrendered. */
  template: { subject: string; bodyHtml: string }
  variables: Record<string, string>
}

export interface FramedEmail extends RenderedEmail {
  subject: string
}

const INVITES: ReadonlySet<string> = new Set(['admin_invite', 'instructor_invite', 'client_invite'])
const CODES: ReadonlySet<string> = new Set(['sign_in_code', 'staff_two_factor_code'])

/** The footer's "why am I getting this" line. */
export function reasonLine(slug: string, recipientKind: 'client' | 'staff', studioName: string): string {
  if (INVITES.has(slug)) return `You're receiving this because ${studioName} invited this address to an account.`
  if (CODES.has(slug)) return `You're receiving this because someone asked to sign in to ${studioName} with this address.`
  return recipientKind === 'staff'
    ? `You're receiving this because you're on the ${studioName} team.`
    : `You're receiving this because you have an account with ${studioName}.`
}

export function frameTemplatedEmail(input: FrameInput): FramedEmail {
  const { bodyHtml, footerNote } = templateBodyFragment(input.template.bodyHtml)
  const subject = renderTemplate(input.template.subject, input.variables)
  // Subjects are plain text; `renderTemplate` escapes for HTML, so undo that
  // for the header while the body keeps its escaping.
  const plainSubject = subject
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  const rendered = renderEmail({
    brandName: input.studioName,
    subject: plainSubject,
    bodyHtml: renderTemplate(bodyHtml, input.variables),
    footerNote,
    reason: reasonLine(input.slug, input.recipientKind, input.studioName),
  })
  return { subject: plainSubject, ...rendered }
}
