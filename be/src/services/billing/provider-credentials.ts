import { eq, sql } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { tenantPaymentCredentials } from '../../db/schema/tenancy'
import { open, seal } from '../../lib/secret-box'

/**
 * A Tenant's own payment-provider credentials — the store, and nothing else.
 *
 * Deliberately free of any `stripe` import. `lib/stripe.ts` imports this to
 * answer "which account is this call on?", so a dependency the other way would
 * be a cycle; validating a key against the provider therefore lives over there,
 * where the client is, and this file only ever reads, seals and writes.
 *
 * ## The secret never leaves as data
 *
 * `secretKey` and `webhookSecret` are defined **non-enumerable** on the object
 * this module hands out. That is not decoration: `JSON.stringify` skips them, a
 * pino log line skips them, and a Sentry event's serialiser skips them. So the
 * ordinary accidents — `logger.info({ credentials })` while debugging, an
 * exception whose context carries the object, a route that spreads it into a
 * response — cannot disclose a studio's live payment key. Reading it requires
 * naming the property, which is a thing somebody has to mean.
 */
export type TenantProviderCredentials = {
  /** The provider account these credentials open. Not a secret: it names the
   *  account, and it is what the super portal shows back. */
  accountId: string
  /** The API key every call on this studio's behalf is made with. */
  readonly secretKey: string
  /** The secret this studio's account signs its webhook deliveries with. */
  readonly webhookSecret: string
}

function credentials(
  accountId: string,
  secretKey: string,
  webhookSecret: string,
): TenantProviderCredentials {
  const value = { accountId } as TenantProviderCredentials
  Object.defineProperty(value, 'secretKey', { value: secretKey, enumerable: false })
  Object.defineProperty(value, 'webhookSecret', { value: webhookSecret, enumerable: false })
  return value
}

/**
 * Short-TTL memo, for the same reason the tenant row has one: this is read on
 * every provider call — checkout, refunds, the receipt lookup — for a row that
 * changes about never, and each miss is a database round trip plus two AES
 * opens.
 *
 * Negative results are cached too, unlike the tenant memos. The key is a tenant
 * id this database already produced rather than a string a caller made up, so
 * there is no flood of unknown keys to pin in memory — and the negative answer
 * is the common one while studios are still being onboarded one at a time.
 */
const TTL_MS = 60_000
const cache = new Map<string, { at: number; value: TenantProviderCredentials | null }>()

/**
 * Drop the memo. Called whenever credentials are written, so a studio that has
 * just been moved onto its own account does not keep selling on the platform's
 * for another minute — and so a corrected key takes effect at once rather than
 * after a redeploy.
 */
export function forgetProviderCredentials(): void {
  cache.clear()
}

type SealedRow = {
  account_id: string
  secret_key_sealed: string
  webhook_secret_sealed: string
}

/**
 * A Tenant's credentials, or null when it has none and therefore takes no online
 * payments (#293).
 *
 * The read goes through `tenant_payment_credentials_for()` (migration 0067) because the
 * callers have no Tenant context to open: a background job has no request, and
 * the webhook cannot open a context until it knows whose delivery this is —
 * which is the very question the credentials answer.
 *
 * **Throws** when a row exists and cannot be opened — a wrong or rotated
 * `PAYMENT_CREDENTIALS_KEY`, a tampered row. Returning null there would read as
 * "this studio has no account of its own" and quietly take its members' money
 * onto the platform's, which is the one outcome worth failing a checkout over.
 */
async function loadFromDatabase(tenantId: string): Promise<TenantProviderCredentials | null> {
  const cached = cache.get(tenantId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value
  if (cached) cache.delete(tenantId)

  const rows = await db.execute<SealedRow>(
    sql`SELECT account_id, secret_key_sealed, webhook_secret_sealed
        FROM public.tenant_payment_credentials_for(${tenantId}::uuid)`,
  )
  const row = rows[0]
  const value = row
    ? credentials(row.account_id, open(row.secret_key_sealed), open(row.webhook_secret_sealed))
    : null

  cache.set(tenantId, { at: Date.now(), value })
  return value
}

export type CredentialsLoader = (tenantId: string) => Promise<TenantProviderCredentials | null>

let loader: CredentialsLoader = loadFromDatabase

/**
 * Substitute the lookup — the test seam, and the twin of `setStripeFactory`.
 *
 * Every provider call now asks this question first, so without a seam here the
 * billing tests that deliberately touch no database would each open a Postgres
 * connection to ask which account a charge is on. Pass `null` to restore the
 * real lookup; the memo is cleared both ways, so a substituted answer cannot
 * outlive the test that installed it.
 */
export function setProviderCredentialsLoader(next: CredentialsLoader | null): void {
  loader = next ?? loadFromDatabase
  cache.clear()
}

/**
 * Build a credentials object.
 *
 * The **only** way one should ever be made outside this module. Assembling the
 * shape by hand produces an object whose secrets are ordinary enumerable
 * properties — which is to say, one a log line or a Sentry event will happily
 * serialise. Two callers need this: a test substituting the loader, and the
 * probe that validates a key before it is stored.
 */
export function providerCredentials(input: {
  accountId: string
  secretKey: string
  webhookSecret: string
}): TenantProviderCredentials {
  return credentials(input.accountId, input.secretKey, input.webhookSecret)
}

export const loadProviderCredentials: CredentialsLoader = tenantId => loader(tenantId)

/** What the super portal is allowed to know about a studio's account. */
export type ProviderAccountStatus = {
  configured: boolean
  /** Which account, when there is one. Never the secret. */
  accountId: string | null
}

/** A studio that has supplied nothing — which is to say, one still charging on
 *  the platform's account. Exported so the route serialising it and the store
 *  answering it cannot drift into two different shapes of "no". */
export const NO_PAYMENT_ACCOUNT: ProviderAccountStatus = { configured: false, accountId: null }

/**
 * Every studio that has an account of its own, for the super portal's list.
 *
 * Through `tenant_payment_accounts()` (migration 0067) because the super portal
 * is cross-tenant and holds no context — and that function returns the tenant
 * id and the account id only, so no sealed value is anywhere near this path.
 */
export async function providerAccountStatuses(): Promise<Map<string, ProviderAccountStatus>> {
  const rows = await db.execute<{ tenant_id: string; account_id: string }>(
    sql`SELECT tenant_id, account_id FROM public.tenant_payment_accounts()`,
  )
  return new Map(
    rows.map(row => [row.tenant_id, { configured: true, accountId: row.account_id }]),
  )
}

/** The same answer for one studio. */
export async function providerAccountStatus(tenantId: string): Promise<ProviderAccountStatus> {
  // Asked of one studio rather than filtered out of every studio's answer: this
  // runs on routes that already know which studio they are acting for.
  const rows = await db.execute<{ account_id: string }>(
    sql`SELECT account_id FROM public.tenant_payment_credentials_for(${tenantId}::uuid)`,
  )
  const accountId = rows[0]?.account_id
  return accountId ? { configured: true, accountId } : NO_PAYMENT_ACCOUNT
}

/**
 * Save (or replace) a studio's credentials.
 *
 * The write runs inside `withTenant`, so the Row-Level Security policy on the
 * table applies to it in full — the super portal names the studio it is acting
 * for rather than being trusted to have got the `WHERE` right. The caller is
 * expected to have validated the key against the provider first; that is what
 * produced `accountId`.
 */
export async function saveProviderCredentials(
  tenantId: string,
  input: { accountId: string; secretKey: string; webhookSecret: string },
): Promise<ProviderAccountStatus> {
  const values = {
    tenantId,
    provider: 'stripe',
    accountId: input.accountId,
    secretKeySealed: seal(input.secretKey),
    webhookSecretSealed: seal(input.webhookSecret),
    updatedAt: new Date(),
  }

  await withTenant(tenantId, () =>
    db
      .insert(tenantPaymentCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: tenantPaymentCredentials.tenantId,
        set: {
          accountId: values.accountId,
          secretKeySealed: values.secretKeySealed,
          webhookSecretSealed: values.webhookSecretSealed,
          updatedAt: values.updatedAt,
        },
      }),
  )

  forgetProviderCredentials()
  return { configured: true, accountId: input.accountId }
}

/**
 * Take a studio back off its own account.
 *
 * The way out of a mistake, and the only one: credentials that turn out to be
 * the wrong studio's cannot be corrected by looking at them, because nobody can
 * look at them. Afterwards the studio takes no online payments until new ones
 * are entered (#293) — which is where every studio starts.
 */
export async function clearProviderCredentials(tenantId: string): Promise<ProviderAccountStatus> {
  // The `where` is redundant under the policy and written anyway: a delete with
  // no clause at all reads as "every studio's", and the reader should not have
  // to know the policy to see that it is not.
  await withTenant(tenantId, () =>
    db.delete(tenantPaymentCredentials).where(eq(tenantPaymentCredentials.tenantId, tenantId)),
  )
  forgetProviderCredentials()
  return NO_PAYMENT_ACCOUNT
}
