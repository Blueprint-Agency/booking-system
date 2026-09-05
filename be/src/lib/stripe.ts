import Stripe from 'stripe'
import { env } from '../env'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
})

/**
 * The card statement is one Stripe account's, and every studio charges on it
 * (v1 — Stripe Connect is issue #71). The one per-charge thing Stripe lets a
 * platform vary on a shared account is the descriptor *suffix*, appended to the
 * account's fixed prefix as `PREFIX* SUFFIX`, and the pair together may not
 * exceed 22 characters.
 *
 * The prefix is a dashboard setting that changes about never, so it is
 * configuration (`STRIPE_STATEMENT_DESCRIPTOR_PREFIX`) rather than something
 * read back from the account per process. Reading it live would mean a Stripe
 * round trip that can fail — dropping the studio's name from a statement with
 * no way to notice — and a value that silently disagrees between running
 * instances after someone edits it. Configured, a change is a deploy.
 */
const DESCRIPTOR_MAX = 22
const SEPARATOR = '* '

/**
 * The studio's name as a statement descriptor suffix, or undefined when it
 * cannot be sent safely — no prefix configured (Stripe refuses a suffix without
 * one), or no room left after it. A charge carrying the platform's name alone
 * is better than a charge Stripe rejects.
 *
 * Stripe's rules for the text: letters, digits and spaces only, at least one
 * letter, and none of `<>\'"*`.
 */
export function statementDescriptorSuffix(studioName: string): string | undefined {
  return descriptorSuffix(env.STRIPE_STATEMENT_DESCRIPTOR_PREFIX, studioName)
}

/** The rule itself, with the configured prefix passed in so it can be tested. */
export function descriptorSuffix(
  prefix: string | undefined,
  studioName: string,
): string | undefined {
  if (!prefix) return undefined
  const room = DESCRIPTOR_MAX - prefix.length - SEPARATOR.length
  if (room < 1) return undefined
  const cleaned = studioName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, room)
    .trim()
  return /[A-Za-z]/.test(cleaned) ? cleaned : undefined
}
