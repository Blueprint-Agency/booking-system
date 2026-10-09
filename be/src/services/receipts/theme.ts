/**
 * How a Receipt looks, wherever it is shown: the colours and the platform's
 * credit that the PDF (`pdf.ts`) and the HTML (`html.ts`: the email's receipt
 * block and both apps' Receipt pages) are drawn with. What a Receipt *says* is
 * `document.ts`; this is the rest of its single source.
 *
 * The neutrals are the email palette, so a Receipt matches the email it is
 * attached to.
 */
import { EMAIL_COLORS } from '../mail/layout'

export const RECEIPT_COLORS = {
  ink: EMAIL_COLORS.ink,
  muted: EMAIL_COLORS.muted,
  rule: EMAIL_COLORS.border,
  /** The amount-paid panel. */
  panel: EMAIL_COLORS.panel,
  /** The RECEIPT label and the rule under the table's headings. */
  accent: EMAIL_COLORS.primary,
  paper: '#ffffff',
  /** The band across the top, and the ground of the platform's mark (fe-client `public/brand/platform-mark.svg`). */
  navy: '#0f172a',
  markLight: '#f8fafc',
  paid: '#1d6b45',
  paidGround: '#e3f2ea',
  refunded: '#b42318',
  refundedGround: '#fdeceb',
} as const

/** Who the studio issues its Receipts through, credited at the foot of every Receipt. */
export const PLATFORM_CREDIT = { name: 'ReserveToday', site: 'reservetoday.app' } as const

/** The body of the platform's mark, as `platform-mark.svg` draws it on its 64-unit grid. */
export const MARK_BODY_PATH =
  'M20 16h24a2 2 0 0 1 2 2v30.6a1.4 1.4 0 0 1-2.2 1.14L32 41.2l-11.8 8.54A1.4 1.4 0 0 1 18 48.6V18a2 2 0 0 1 2-2Z'
