import type Stripe from 'stripe'
import { setStripeFactory, type ProviderAccount } from '../lib/stripe'

/**
 * A stand-in payment provider, installed at the one seam every call goes
 * through (`lib/stripe.ts`).
 *
 * The point is that nothing is intercepted: no HTTP is stubbed, no module is
 * patched, no key is needed. The accessor is asked for a client and hands back
 * this instead, so a test drives checkout, the webhook and refunds exactly as
 * the real code does — and can then read back *which account* each call was
 * made against, which is the fact Stripe Connect (#94) turns on.
 */
export type ProviderCall = {
  /** The account the client was bound to — null is the platform's own. */
  account: ProviderAccount
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
  /** Put the real provider back. Always call this from an `after` hook. */
  restore(): void
}

function recorder(fake: StripeFake, replies: Map<string, Reply>, account: ProviderAccount, path: string): any {
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
  const fake: StripeFake = {
    calls: [],
    callsTo: method => fake.calls.filter(call => call.method === method),
    reply: (method, value) => {
      replies.set(method, value)
    },
    restore: () => setStripeFactory(null),
  }
  setStripeFactory(account => recorder(fake, replies, account, '') as unknown as Stripe)
  return fake
}
