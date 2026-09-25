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
  /** Put the real provider back. Always call this from an `after` hook. */
  restore(): void
}

function recorder(fake: StripeFake, replies: Map<string, Reply>, account: string | null, path: string): any {
  return new Proxy(function () {}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      // `stripeForTenant` is async, so its return value is checked for `then`.
      // Answering that with a recorder would make the client look like a promise
      // that never settles — and every awaited call would simply hang.
      if (property === 'then') return undefined
      return recorder(fake, replies, account, path ? `${path}.${property}` : property)
    },
    apply(_target, _thisArg, args: unknown[]) {
      fake.calls.push({ account, method: path, args })
      const reply = replies.get(path)
      if (reply instanceof Error) throw reply
      if (typeof reply === 'function') return (reply as (...a: unknown[]) => unknown)(...args)
      return reply
    },
  })
}

export function installStripeFake(): StripeFake {
  const replies = new Map<string, Reply>()
  const accounts = new Map<string, ReturnType<typeof providerCredentials>>()
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
    restore: () => {
      setStripeFactory(null)
      setProviderCredentialsLoader(null)
    },
  }
  // Both halves of the seam, together. The credentials lookup is what the
  // accessor asks first, and leaving it on the real one would send every test
  // that installs a fake provider to the database to find out which account a
  // charge is on.
  setProviderCredentialsLoader(async tenantId => accounts.get(tenantId) ?? null)
  setStripeFactory(
    account => recorder(fake, replies, account?.accountId || null, '') as unknown as Stripe,
  )
  return fake
}
