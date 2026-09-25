/**
 * Every email the platform sends, rendered with invented values — for the
 * layout test and for `render-samples.ts`, which writes them to disk for a
 * human to look at. Pure: no env, no database.
 *
 * The studio is invented on purpose (no real studio may be named in this
 * repo), and its name carries markup so every sample doubles as an escaping
 * check.
 */
import { buildEmailTemplates } from '../../db/seed/email-copy'
import { platformPasswordResetEmail, platformTwoFactorEmail } from '../auth/platform-mail'
import { frameTemplatedEmail } from '../notifications/frame'
import { TEMPLATE_VARIABLES } from '../notifications/variables'

export const SAMPLE_STUDIO = 'Sample <b>Studio</b> & Co'

/** Who each template goes to — staff mail says so in its footer. */
const STAFF_SLUGS: ReadonlySet<string> = new Set([
  'instructor_invite',
  'admin_invite',
  'instructor_cancel_class',
  'leave_request_submitted',
  'leave_approved',
  'leave_rejected',
  'leave_revoked',
  'checkin_nag',
  'staff_two_factor_code',
  'staff_password_reset',
])

export const recipientKindOf = (slug: string): 'client' | 'staff' => (STAFF_SLUGS.has(slug) ? 'staff' : 'client')

const PERSON = `Alex <O'Neill>`
const SAMPLE_VALUES: Record<string, string> = {
  client_name: PERSON,
  name: PERSON,
  referrer_name: PERSON,
  referee_name: 'Sam Lee',
  instructor_name: 'Jordan Tan',
  class_name: 'Morning Flow',
  workshop_name: 'Inversions Workshop',
  package_name: '10-Class Pack',
  date: 'Mon 5 Oct 2026, 7:00 AM',
  starts_at: 'Tue 6 Oct 2026, 6:30 PM',
  location: 'Studio A',
  location_name: 'Studio A',
  time: '7:00 AM',
  cancel_by: 'Sun 4 Oct 2026, 7:00 AM',
  code: '482915',
  credits_remaining: '9',
  credits_returned: '1',
  credits_granted: '1',
  refund_sgd: '120.00',
  refunded_count: '8',
  pending_count: '3',
  session_label: 'Morning Flow, Mon 5 Oct 7:00 AM',
  reason: 'Unwell — sorry for the short notice.',
  reason_line: 'The cancellation was inside the 12-hour window, so the credit was not returned.',
  decline_note: 'Fully booked that evening.',
  contents_line: '10 class credits',
  validity_line: 'Valid 90 days from your first class — your package activates when you make your first booking.',
  remaining_line: '3 class credits',
  refund_line: 'SGD 150.00 has been refunded to your card.',
  cancelled_line: 'No booked classes were cancelled.',
  expires_at: '14 Oct 2026',
  claim_deadline: 'Wed 7 Oct 2026, 12:00 PM',
  leave_type: 'annual',
  dates: '12–14 Oct 2026',
  days: '3',
  cap_warning: '',
  revoked_by: 'Casey Admin',
  revoked_at: '8 Oct 2026',
  invitee_email: 'alex@example.test',
}

const url = (path: string) => `https://sample.example.test${path}?token=abc&x=1`
const urlValue = (name: string) => (name.endsWith('_url') ? url(`/${name.replace(/_url$/, '')}`) : undefined)

export function sampleVariables(slug: keyof typeof TEMPLATE_VARIABLES): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARIABLES[slug].map(v => [v, urlValue(v) ?? SAMPLE_VALUES[v] ?? `[${v}]`]))
}

export interface SampleEmail {
  slug: string
  audience: 'client' | 'staff' | 'platform'
  subject: string
  html: string
  text: string
}

export function sampleEmails(studioName: string = SAMPLE_STUDIO): SampleEmail[] {
  const templates = buildEmailTemplates({
    clientUrl: 'https://sample.example.test',
    portalUrl: 'https://sample.portal.example.test',
    studio: { name: studioName, footer: '1 Example Street, #02-01.' },
  })

  const tenantMail = templates.map(t => {
    const slug = t.slug as keyof typeof TEMPLATE_VARIABLES
    const recipientKind = recipientKindOf(slug)
    const framed = frameTemplatedEmail({
      slug,
      recipientKind,
      studioName,
      template: t,
      variables: sampleVariables(slug),
    })
    return { slug, audience: recipientKind, ...framed }
  })

  return [
    ...tenantMail,
    { audience: 'platform', ...platformTwoFactorEmail(PERSON, '482915') },
    { audience: 'platform', ...platformPasswordResetEmail(PERSON, url('/reset-password/xyz')) },
  ]
}
