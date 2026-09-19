import { createHash } from 'node:crypto'
import Stripe from 'stripe'
import { env } from '../env'
import { logger } from '../shared/logger'
import {
  loadProviderCredentials,
  providerCredentials,
  type TenantProviderCredentials,
} from '../services/billing/provider-credentials'

/**
 * The one way into the payment provider.
 *
 * There is deliberately **no exported client**. Every call is made through
 * `stripeForTenant`, which binds the client to the studio whose money is
 * moving, so the question "which account is this charge on?" is answered in
 * exactly one place — `providerAccountForTenant` below.
 *
 * Since #100 that answer is the studio's *own* account, when it has supplied
 * one. Not a connected account: Stripe Connect is unavailable to this platform,
 * so there is no `Stripe-Account` header and no platform account in the middle.
 * A studio's credentials are a whole different API key, and the client is built
 * with it — which is why the account is bound to the client rather than passed
 * per call. A studio that has supplied none still sells on the platform's
 * account, exactly as every studio did before.
 *
 * It is also the seam a test substitutes: `setStripeFactory` swaps in a fake
 * client, so checkout, the webhook and refunds can be exercised without a
 * network or a Stripe key.
 */
export const STRIPE_API_VERSION = '2023-10-16'

/**
 * The provider account a call is made against, or null for the platform's own.
 * `null` is not "unknown" — it is the platform account, which is where a studio
 * that has supplied no credentials of its own still sells.
 */
export type ProviderAccount = TenantProviderCredentials | null

export type StripeFactory = (account: ProviderAccount) => Stripe

function realClient(account: ProviderAccount): Stripe {
  // The studio's own key, or the platform's. There is no third case: an account
  // is a key here, not a header, so a call cannot half-belong to a studio.
  return new Stripe(account?.secretKey ?? env.STRIPE_SECRET_KEY ?? '', {
    apiVersion: STRIPE_API_VERSION,
  })
}

let factory: StripeFactory = realClient
/**
 * Keyed by account, so the ordinary path builds one client per process.
 *
 * The key carries a digest of the secret as well as the account id, because a
 * studio that rotates its key keeps the same account — and a cache keyed on the
 * account alone would go on charging with the revoked key until the process
 * restarted. The digest, not the key: this map is in memory, but a secret used
 * as a map key is a secret one heap dump away from being read.
 */
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

function cacheKey(account: ProviderAccount): string {
  if (!account) return ''
  const digest = createHash('sha256').update(account.secretKey).digest('hex').slice(0, 16)
  return `${account.accountId}:${digest}`
}

function clientFor(account: ProviderAccount): Stripe {
  const key = cacheKey(account)
  const cached = clients.get(key)
  if (cached) return cached
  const client = factory(account)
  clients.set(key, client)
  return client
}

/**
 * How a Tenant maps to a provider account — the single fact this module owns.
 *
 * A studio that has supplied its own credentials maps to them; one that has not
 * maps to `null`, the platform's account, which is where every studio sold
 * before #100 and where every studio still sells until it is moved. That is
 * what makes onboarding one studio at a time possible: the studios behind it
 * are not waiting on anything.
 *
 * It **throws** rather than falling back when a studio has credentials that
 * cannot be opened. Falling back would mean taking that studio's members' money
 * onto the platform's account — a silent misdirection of somebody else's
 * revenue, which is worse than a failed checkout by a wide margin.
 */
export async function providerAccountForTenant(tenantId: string): Promise<ProviderAccount> {
  return loadProviderCredentials(tenantId)
}

/** The provider, bound to the studio whose money is moving. */
export async function stripeForTenant(tenantId: string): Promise<Stripe> {
  return clientFor(await providerAccountForTenant(tenantId))
}

/**
 * The provider, bound to the account a *particular payment* was taken on (#97).
 *
 * `stripeForTenant` answers "where does this studio sell today?", which is the
 * right question for a charge and the wrong one for a Refund. Money goes back
 * on the account it came in on, and a studio that has moved onto its own
 * account left its history on the platform's — no provider will hand a payment
 * intent across accounts, so that history stays where it is, refundable,
 * indefinitely. Asking today's credentials would send a refund of a historical
 * payment to an account where the intent does not exist: the member gets
 * nothing back, and the admin gets an error naming an id that looks right.
 *
 * `accountId` comes off the payment row, where `null` means the platform's own.
 *
 * A studio can therefore hold payments on two accounts at once, and a single
 * Purchase can too — one card before the move and one after. Each is returned
 * on its own account, and neither knows about the other.
 *
 * It **throws** for an account this platform holds no key for, which is a
 * studio whose credentials were replaced with a different account's after money
 * was taken. There is nothing sensible to do there: the platform's key cannot
 * reach that intent either, so falling back would turn a legible failure into a
 * confusing one — and a refund silently not happening is worse than one that
 * says so.
 */
export async function stripeForProviderAccount(
  tenantId: string,
  accountId: string | null,
): Promise<Stripe> {
  if (!accountId) return stripePlatform()
  const current = await providerAccountForTenant(tenantId)
  if (current?.accountId === accountId) return clientFor(current)
  throw new Error(
    `no credentials held for provider account ${accountId} — this payment was taken on an account this studio no longer supplies`,
  )
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
 * Is this key real, and whose account is it?
 *
 * Called once, when the super portal saves a studio's credentials, and it is
 * the reason a wrong key is a message on that form rather than a member's
 * checkout failing weeks later — by which point nobody can look at the stored
 * key to see what went wrong, because nobody can look at it at all.
 *
 * It answers with the account id the provider itself reports, which is then
 * what gets stored and shown. Taking it from the provider rather than from the
 * person pasting the key means the super portal's "these credentials belong to
 * acct_xxx" is a fact and not a label.
 *
 * The client here is built and thrown away rather than cached: a key that turns
 * out to be wrong must leave nothing behind.
 */
export async function providerAccountForKey(secretKey: string): Promise<string> {
  // Built through `providerCredentials`, not as a literal: that is what makes
  // the secret non-enumerable, and a probe object assembled by hand would be
  // the one credentials object on this platform that a log line or a Sentry
  // event could serialise. The two empty strings are honest here — the account
  // is what this call is about to find out, and a probe verifies no webhook.
  const probe = factory(providerCredentials({ accountId: '', secretKey, webhookSecret: '' }))
  const account = await probe.accounts.retrieve()
  if (!account?.id) throw new Error('the provider returned no account for that key')
  return account.id
}

/**
 * The card statement is one Stripe account's, and every studio that has not yet
 * supplied credentials of its own charges on the platform's. The one per-charge
 * thing Stripe lets a platform vary on a shared account is the descriptor
 * *suffix*, appended to the account's fixed prefix as `PREFIX* SUFFIX`, and the
 * pair together may not exceed 22 characters.
 *
 * A studio charging on its own account (#100) has no such problem — the
 * statement already says its name — but the suffix is harmless there and the
 * prefix below is the platform's, so nothing here needs to know which case it
 * is in.
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
  // Trimmed on the way in so the boot check below and the charge path agree on
  // what the configured prefix is — a value pasted into a GitHub variable with
  // stray whitespace must not pass the check and then eat a character of the
  // suffix's room.
  return descriptorSuffix(env.STRIPE_STATEMENT_DESCRIPTOR_PREFIX?.trim(), studioName)
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
