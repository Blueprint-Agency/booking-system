import Stripe from 'stripe'
import { env } from '../env'
import { logger } from '../shared/logger'
import { VENDOR_DEADLINE_MS } from './outbound'

/**
 * The one way into the payment provider.
 *
 * There is deliberately **no exported client**. Every call is made through
 * `stripeForTenant`, which binds the client to the studio whose money is
 * moving, so the question "which account is this charge on?" is answered in
 * exactly one place — `providerAccountForTenant` below. Today that answer is
 * always the platform's own account; when a studio connects its own (#94), that
 * function is the change, and no call site moves.
 *
 * It is also the seam a test substitutes: `setStripeFactory` swaps in a fake
 * client, so checkout, the webhook and refunds can be exercised without a
 * network or a Stripe key.
 */
export const STRIPE_API_VERSION = '2023-10-16'

/**
 * The provider account a call is made against, or null for the platform's own.
 * `null` is not "unknown" — it is the platform account, which is where every
 * studio still sells.
 */
export type ProviderAccount = string | null

export type StripeFactory = (account: ProviderAccount) => Stripe

/**
 * Every network call on a client built here goes through `outbound`
 * (`./outbound.ts`). The SDK's own timeout matches the wrapper's deadline, and
 * it never retries on its own: a retry inside the SDK would run past that
 * deadline unseen. Where a retry is wanted — webhooks and cron, never a route —
 * the wrapper does it.
 */
function realClient(account: ProviderAccount): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY ?? '', {
    apiVersion: STRIPE_API_VERSION,
    timeout: VENDOR_DEADLINE_MS.stripe,
    maxNetworkRetries: 0,
    // Bound on the client rather than passed per call: the whole point of the
    // accessor is that a call site cannot forget it.
    ...(account ? { stripeAccount: account } : {}),
  })
}

let factory: StripeFactory = realClient
/** Keyed by account, so the ordinary path builds one client per process. */
const clients = new Map<string, Stripe>()

/**
 * Substitute the client every accessor hands out — the test seam. Pass `null`
 * to restore the real one. Clears the cache both ways, so a fake can never
 * outlive the test that installed it.
 */
export function setStripeFactory(next: StripeFactory | null): void {
  factory = next ?? realClient
  clients.clear()
}

function clientFor(account: ProviderAccount): Stripe {
  const key = account ?? ''
  const cached = clients.get(key)
  if (cached) return cached
  const client = factory(account)
  clients.set(key, client)
  return client
}

/**
 * How a Tenant maps to a provider account — the single fact this module owns.
 *
 * Every studio sells on the platform's account today, so every Tenant maps to
 * `null`. Async because the connected-account id will be a column on the tenant
 * row (#94), and having the callers already await it is the whole point of
 * doing this ahead of Connect.
 */
export async function providerAccountForTenant(tenantId: string): Promise<ProviderAccount> {
  void tenantId
  return null
}

/** The provider, bound to the studio whose money is moving. */
export async function stripeForTenant(tenantId: string): Promise<Stripe> {
  return clientFor(await providerAccountForTenant(tenantId))
}

/**
 * The platform's own client, for the calls that belong to no studio: verifying
 * a webhook signature, which happens before anything has been routed to a
 * Tenant at all. Use `stripeForTenant` for everything else.
 */
export function stripePlatform(): Stripe {
  return clientFor(null)
}

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

/**
 * Why the suffix cannot be sent, when payments are configured and it therefore
 * matters, or undefined when all is well.
 *
 * `descriptorSuffix` degrades quietly by design — a member's payment is worth
 * more than a statement descriptor, so an unusable prefix drops the suffix
 * rather than failing the charge. That silence is right at checkout and wrong
 * at boot: it is why an unset prefix went unnoticed for months (#98). This is
 * the same rule, stated once, so startup can say it out loud.
 */
export function statementDescriptorPrefixProblem(
  paymentsConfigured: boolean,
  prefix: string | undefined,
): string | undefined {
  // No Stripe key means no charges to mislabel — a local dev environment, or a
  // deployment with payments off, should not be nagged about this.
  if (!paymentsConfigured) return undefined
  const trimmed = prefix?.trim() ?? ''
  if (!trimmed) {
    return (
      'STRIPE_STATEMENT_DESCRIPTOR_PREFIX is not set. Stripe refuses a descriptor ' +
      'suffix without a fixed prefix on the account, so every studio charges under ' +
      "the platform's default descriptor instead of its own name — a name the " +
      'member has never heard of, and a chargeback. Set it to the prefix configured ' +
      'on the Stripe account this environment uses.'
    )
  }
  if (DESCRIPTOR_MAX - trimmed.length - SEPARATOR.length < 1) {
    return (
      `STRIPE_STATEMENT_DESCRIPTOR_PREFIX ("${trimmed}") leaves no room for a suffix ` +
      `within Stripe's ${DESCRIPTOR_MAX}-character limit, so no studio name is ` +
      "appended and every charge carries the platform's name alone. Shorten it to " +
      `at most ${DESCRIPTOR_MAX - SEPARATOR.length - 1} characters, on the Stripe ` +
      'account and here.'
    )
  }
  return undefined
}

/**
 * Say it at boot, once, at `error` level so a deployed environment shows the
 * condition in `docker compose logs booking-be` without anyone reading the
 * checkout path. Never throws — a deployment with a bad descriptor prefix must
 * still take bookings.
 */
export function reportStatementDescriptorPrefix(): void {
  const problem = statementDescriptorPrefixProblem(
    Boolean(env.STRIPE_SECRET_KEY),
    env.STRIPE_STATEMENT_DESCRIPTOR_PREFIX,
  )
  if (!problem) return
  logger.error(
    { appEnv: env.APP_ENV, setting: 'STRIPE_STATEMENT_DESCRIPTOR_PREFIX' },
    `payments misconfigured — ${problem}`,
  )
}
