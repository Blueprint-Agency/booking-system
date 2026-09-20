import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOutbound, retryable, VENDOR_TIMEOUT, VendorTimeoutError, type OutboundLine } from './outbound'

/**
 * The outbound wrapper, driven by a fake vendor on a virtual clock. Nothing
 * here waits in real time and no vendor is called.
 */

function fakeClock() {
  let now = 0
  let seq = 0
  const timers: { at: number; seq: number; resolve: () => void }[] = []
  const flush = () => new Promise<void>(resolve => setImmediate(resolve))
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>(resolve => timers.push({ at: now + Math.max(0, ms), seq: seq++, resolve })),
    /** Move the clock forward by `ms`, firing every timer due on the way. */
    async advance(ms: number) {
      const until = now + ms
      for (;;) {
        await flush()
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
        const next = timers[0]
        if (!next || next.at > until) break
        timers.shift()
        now = next.at
        next.resolve()
      }
      now = until
      await flush()
    },
  }
}

function harness() {
  const clock = fakeClock()
  const lines: OutboundLine[] = []
  const outbound = createOutbound({
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    log: line => lines.push(line),
  })
  return { clock, lines, outbound }
}

/** Settles when the fake clock says so. */
const vendorTaking = (clock: ReturnType<typeof fakeClock>, ms: number, value = 'done') => () =>
  clock.sleep(ms).then(() => value)

test('a call that answers in time resolves and logs ok with its duration', async () => {
  const { clock, lines, outbound } = harness()
  const result = outbound('stripe', 'checkout.sessions.create', vendorTaking(clock, 300), {
    deadlineMs: 1_000,
  })
  await clock.advance(300)
  assert.equal(await result, 'done')
  assert.deepEqual(lines, [
    { vendor: 'stripe', op: 'checkout.sessions.create', ms: 300, outcome: 'ok', attempt: 1 },
  ])
})

test('a call past its deadline rejects with the typed timeout and logs timeout', async () => {
  const { clock, lines, outbound } = harness()
  let signal: AbortSignal | undefined
  const result = outbound(
    'storage',
    'putObject',
    s => {
      signal = s
      return new Promise(() => {})
    },
    { deadlineMs: 1_000 },
  )
  const settled = result.then(
    () => assert.fail('should not resolve'),
    err => err,
  )
  await clock.advance(1_000)
  const err = await settled
  assert.ok(err instanceof VendorTimeoutError)
  assert.equal(err.code, VENDOR_TIMEOUT)
  assert.equal(err.status, 503)
  assert.equal(signal?.aborted, true, 'the SDK is told to give up')
  assert.deepEqual(lines, [{ vendor: 'storage', op: 'putObject', ms: 1_000, outcome: 'timeout', attempt: 1 }])
})

test('a call that throws rejects with its own error and logs error', async () => {
  const { lines, outbound } = harness()
  const boom = Object.assign(new Error('card_declined'), { statusCode: 402 })
  await assert.rejects(
    outbound('stripe', 'refunds.create', async () => {
      throw boom
    }),
    boom,
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.outcome, 'error')
  assert.equal(lines[0]?.err, boom)
})

test('a call that answers is not later reported as a timeout', async () => {
  const { clock, lines, outbound } = harness()
  const result = outbound('resend', 'emails.send', vendorTaking(clock, 10), { deadlineMs: 50 })
  await clock.advance(100)
  assert.equal(await result, 'done')
  assert.deepEqual(
    lines.map(l => l.outcome),
    ['ok'],
  )
})

test('without a retry policy a failure is tried once', async () => {
  const { lines, outbound } = harness()
  let calls = 0
  await assert.rejects(
    outbound('stripe', 'paymentIntents.retrieve', async () => {
      calls++
      throw new Error('network down')
    }),
  )
  assert.equal(calls, 1)
  assert.equal(lines.length, 1)
})

test('with a retry policy a failure is retried with backoff until it succeeds', async () => {
  const { clock, lines, outbound } = harness()
  let calls = 0
  const result = outbound(
    'stripe',
    'paymentIntents.retrieve',
    async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('unavailable'), { statusCode: 503 })
      return 'intent'
    },
    { retry: { attempts: 5, baseMs: 100, capMs: 1_000 } },
  )
  // Backoff with random() = 0.5: 75ms after the first failure, 150ms after the second.
  await clock.advance(74)
  assert.equal(calls, 1)
  await clock.advance(1)
  assert.equal(calls, 2)
  await clock.advance(150)
  assert.equal(await result, 'intent')
  assert.equal(calls, 3)
  assert.deepEqual(
    lines.map(l => [l.outcome, l.attempt]),
    [
      ['error', 1],
      ['error', 2],
      ['ok', 3],
    ],
  )
})

test('retry stops at the bound and rethrows the last failure', async () => {
  const { clock, outbound } = harness()
  let calls = 0
  const result = outbound(
    'storage',
    'putObject',
    () => {
      calls++
      return new Promise(() => {})
    },
    { deadlineMs: 100, retry: { attempts: 3, baseMs: 100, capMs: 1_000 } },
  ).then(
    () => assert.fail('should not resolve'),
    err => err,
  )
  await clock.advance(10_000)
  assert.ok((await result) instanceof VendorTimeoutError)
  assert.equal(calls, 3)
})

test('retry is not spent on a request the vendor refused', async () => {
  const { outbound } = harness()
  let calls = 0
  await assert.rejects(
    outbound(
      'stripe',
      'refunds.create',
      async () => {
        calls++
        throw Object.assign(new Error('invalid'), { statusCode: 400 })
      },
      { retry: { attempts: 3 } },
    ),
  )
  assert.equal(calls, 1)
})

test('retryable: timeouts, network failures, 429 and 5xx; not 4xx', () => {
  assert.equal(retryable(new VendorTimeoutError('stripe', 'x', 1)), true)
  assert.equal(retryable(new Error('ECONNRESET')), true)
  assert.equal(retryable({ statusCode: 429 }), true)
  assert.equal(retryable({ $metadata: { httpStatusCode: 500 } }), true)
  assert.equal(retryable({ statusCode: 404 }), false)
  assert.equal(retryable({ $metadata: { httpStatusCode: 403 } }), false)
})
