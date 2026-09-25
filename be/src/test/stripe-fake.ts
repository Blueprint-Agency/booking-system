import type Stripe from 'stripe'
import { setStripeFactory } from '../lib/stripe'
import {
  providerCredentials,
  setProviderCredentialsLoader,
} from '../services/billing/provider-credentials'

/**
 * A stand-in payment provider, installed at the one seam every call goes
 * through (`lib/stripe.ts`).
 *
 * The point is that nothing is intercepted: no HTTP is stubbed, no module is
 * patched, no key is needed. The accessor is asked for a client and hands back
 * this instead, so a test drives checkout, the webhook and refunds exactly as
 * the real code does — and can then read back *which account* each call was
 * made against, which is the fact a studio's own credentials (#100) turn on.
 */
export type ProviderCall = {
  /**
   * The account the client was bound to. Always a studio's own since #293;
   * typed nullable only so a fake set up by hand can still be read back.
   *
   * The id, not the credentials: a test asserts which studio's account the
   * money moved on, and recording the key alongside it would put live-shaped
   * secrets into assertion output for no gain.
   */
  account: string | null
  /** Dotted path as written at the call site, e.g. `refunds.create`. */
  method: string
  args: unknown[]
}

/** What a faked method answers: a value, a thrower, or a function of the args. */
export type Reply = unknown | ((...args: unknown[]) => unknown)

/** A studio's own account, as `StripeFake.ownAccount` hands it back. */
export type OwnAccount = { accountId: string; webhookPath: string }

/**
 * Where a studio's own account delivers its webhooks (#100). The only Stripe
 * webhook endpoint there is: the platform account's shared one went with it
 * (#293).
 */
export const stripeWebhookPath = (slug: string): string => `/api/v1/webhooks/stripe/${slug}`

/**
 * A webhook endpoint on one account, as the fake keeps it (#294). The shape is
 * the part of Stripe's `WebhookEndpoint` the platform reads: `secret` is only
 * ever in the answer to `create`, as it is at Stripe.
 */
export type FakeWebhookEndpoint = {
  id: string
  url: string
  enabled_events: string[]
  api_version: string | null
  metadata: Record<string, string>
  secret: string
}

/** The account id `ownAccount` gives a studio — stable, so seeded rows can carry it. */
export const ownAccountId = (tenant: { slug: string }): string => `acct_own_${tenant.slug}`

export type StripeFake = {
  /** Every call made through the accessor, in order. */
  calls: ProviderCall[]
  /** Calls to one method, for the common single-method assertion. */
  callsTo(method: string): ProviderCall[]
  /** What `method` answers with. An `Error` is thrown rather than returned. */
  reply(method: string, value: Reply): void
  /**
   * Give a studio its own provider account (#100), so calls on its behalf are
   * recorded against that account. A studio not named here has none, and so
   * takes no online payments (#293) — the same answer the real lookup gives a
   * studio that has supplied no credentials.
   */
  credentials(tenantId: string, account: { accountId: string; secretKey?: string; webhookSecret?: string }): void
  /**
   * Give a harness studio its own account, the way most tests need one: an id
   * that is the same every time (so a payment row seeded with it stays
   * refundable across a reinstalled fake), and the endpoint that studio's
   * account delivers its webhooks to. The fake's `webhooks.constructEvent`
   * reply still decides whether a signature verifies.
   */
  ownAccount(tenant: { id: string; slug: string }): OwnAccount
  /**
   * Make a secret key real: `accounts.retrieve` on a client built with it
   * answers `accountId`. A key never registered here is refused, as Stripe
   * refuses a key it did not issue. A reply set for `accounts.retrieve` wins.
   */
  issueKey(secretKey: string, accountId: string): void
  /**
   * The webhook endpoints on one account, live. `webhookEndpoints.create`,
   * `.list` and `.del` on a client bound to that account read and write this,
   * unless a reply is set for them.
   */
  webhookEndpoints(accountId: string): FakeWebhookEndpoint[]
  /** Create an endpoint on an account, as `webhookEndpoints.create` does. */
  createWebhookEndpoint(
    accountId: string,
    params: { url: string; enabled_events: string[]; api_version?: string; metadata?: Record<string, string> },
  ): FakeWebhookEndpoint
  /** Put the real provider back. Always call this from an `after` hook. */
  restore(): void
}

/** What a method does when no reply is set for it. */
type Defaults = Map<string, (client: { account: string | null; secretKey: string }, args: unknown[]) => unknown>

function recorder(
  fake: StripeFake,
  replies: Map<string, Reply>,
  defaults: Defaults,
  client: { account: string | null; secretKey: string },
  path: string,
): any {
  const account = client.account
  return new Proxy(function () {}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      // `stripeForTenant` is async, so its return value is checked for `then`.
      // Answering that with a recorder would make the client look like a promise
      // that never settles — and every awaited call would simply hang.
      if (property === 'then') return undefined
      return recorder(fake, replies, defaults, client, path ? `${path}.${property}` : property)
    },
    apply(_target, _thisArg, args: unknown[]) {
      fake.calls.push({ account, method: path, args })
      if (!replies.has(path)) {
        const fallback = defaults.get(path)
        if (fallback) return Promise.resolve().then(() => fallback(client, args))
      }
      const reply = replies.get(path)
      if (reply instanceof Error) throw reply
      if (typeof reply === 'function') return (reply as (...a: unknown[]) => unknown)(...args)
      return reply
    },
  })
}

/**
 * `credentials: 'database'` leaves the real credentials lookup in place, for a
 * test of the store itself: credentials the super portal saves are then the
 * ones every provider call is made with.
 */
export function installStripeFake(options: { credentials?: 'fake' | 'database' } = {}): StripeFake {
  const replies = new Map<string, Reply>()
  const accounts = new Map<string, ReturnType<typeof providerCredentials>>()
  const keys = new Map<string, string>()
  const endpoints = new Map<string, FakeWebhookEndpoint[]>()
  let nextEndpoint = 0
  const endpointsOn = (accountId: string): FakeWebhookEndpoint[] => {
    const list = endpoints.get(accountId) ?? []
    endpoints.set(accountId, list)
    return list
  }
  const bound = (client: { account: string | null }): string => {
    if (!client.account) throw new Error('webhook endpoints need a client bound to an account')
    return client.account
  }
  const defaults: Defaults = new Map<string, (client: { account: string | null; secretKey: string }, args: unknown[]) => unknown>([
    [
      'accounts.retrieve',
      client => {
        const id = keys.get(client.secretKey)
        if (!id) throw new Error('Invalid API Key provided')
        return { id, object: 'account' }
      },
    ],
    [
      'webhookEndpoints.create',
      (client, [params]) =>
        fake.createWebhookEndpoint(bound(client), params as Parameters<StripeFake['createWebhookEndpoint']>[1]),
    ],
    [
      'webhookEndpoints.list',
      client => ({
        object: 'list',
        has_more: false,
        // Listed without the secret, as Stripe lists them.
        data: endpointsOn(bound(client)).map(({ secret: _secret, ...rest }) => ({ ...rest, object: 'webhook_endpoint' })),
      }),
    ],
    [
      'webhookEndpoints.del',
      (client, [id]) => {
        const list = endpointsOn(bound(client))
        const at = list.findIndex(endpoint => endpoint.id === id)
        if (at < 0) throw new Error(`No such webhook endpoint: '${String(id)}'`)
        list.splice(at, 1)
        return { id, object: 'webhook_endpoint', deleted: true }
      },
    ],
  ])
  const fake: StripeFake = {
    calls: [],
    callsTo: method => fake.calls.filter(call => call.method === method),
    reply: (method, value) => {
      replies.set(method, value)
    },
    credentials: (tenantId, account) => {
      accounts.set(
        tenantId,
        providerCredentials({
          accountId: account.accountId,
          secretKey: account.secretKey ?? `sk_test_${account.accountId}`,
          webhookSecret: account.webhookSecret ?? `whsec_${account.accountId}`,
        }),
      )
    },
    ownAccount: tenant => {
      const accountId = ownAccountId(tenant)
      fake.credentials(tenant.id, { accountId })
      return { accountId, webhookPath: stripeWebhookPath(tenant.slug) }
    },
    issueKey: (secretKey, accountId) => {
      keys.set(secretKey, accountId)
    },
    webhookEndpoints: accountId => endpointsOn(accountId),
    createWebhookEndpoint: (accountId, params) => {
      nextEndpoint += 1
      const endpoint: FakeWebhookEndpoint = {
        id: `we_fake_${nextEndpoint}`,
        url: params.url,
        enabled_events: [...params.enabled_events],
        api_version: params.api_version ?? null,
        metadata: { ...(params.metadata ?? {}) },
        secret: `whsec_fake_${accountId}_${nextEndpoint}`,
      }
      endpointsOn(accountId).push(endpoint)
      return { ...endpoint }
    },
    restore: () => {
      setStripeFactory(null)
      setProviderCredentialsLoader(null)
    },
  }
  // Both halves of the seam, together. The credentials lookup is what the
  // accessor asks first, and leaving it on the real one would send every test
  // that installs a fake provider to the database to find out which account a
  // charge is on.
  if (options.credentials !== 'database') {
    setProviderCredentialsLoader(async tenantId => accounts.get(tenantId) ?? null)
  }
  setStripeFactory(
    account =>
      recorder(
        fake,
        replies,
        defaults,
        { account: account?.accountId || null, secretKey: account?.secretKey ?? '' },
        '',
      ) as unknown as Stripe,
  )
  return fake
}
