import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSendGate,
  type GateMessage,
  type MailReporter,
  type ResendClient,
  type ResendResponse,
} from './send-gate'

/**
 * The send gate, driven by a scripted fake Resend on a virtual clock.
 *
 * Nothing here waits in real time: `sleep` parks a timer on the fake clock and
 * `settle` fires the timers in order, flushing every promise between them — so
 * a `retry-after: 2` is two virtual seconds and no real ones.
 */

function fakeClock() {
  let now = 0
  const timers: { at: number; seq: number; resolve: () => void }[] = []
  let seq = 0
  const flush = () => new Promise<void>(resolve => setImmediate(resolve))
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>(resolve => timers.push({ at: now + Math.max(0, ms), seq: seq++, resolve })),
    /** Run the clock forward until nothing is left waiting on it. */
    async settle() {
      for (let i = 0; i < 100_000; i++) {
        await flush()
        if (timers.length === 0) return
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
        const next = timers.shift()!
        now = Math.max(now, next.at)
        next.resolve()
      }
      throw new Error('clock never settled')
    },
  }
}

type Call = { at: number; to: string; idempotencyKey: string; tags: { name: string; value: string }[] }

const ok = (headers: Record<string, string> = {}): ResendResponse => ({
  data: { id: `msg-${Math.random()}` },
  error: null,
  headers,
})
const refused = (name: string, statusCode: number | null, headers: Record<string, string> = {}): ResendResponse => ({
  data: null,
  error: { name, message: `${name} (scripted)`, statusCode },
  headers,
})

/** A fake Resend that answers from a script, then succeeds. */
function fakeResend(clock: ReturnType<typeof fakeClock>, script: ResendResponse[] = []) {
  const calls: Call[] = []
  const client: ResendClient = {
    async send(payload, options) {
      calls.push({ at: clock.now(), to: payload.to, idempotencyKey: options.idempotencyKey, tags: payload.tags })
      return script.shift() ?? ok()
    },
  }
  return { client, calls }
}

function recordingReporter() {
  const warnings: { code: string; context: Record<string, unknown> }[] = []
  const alerts: { code: string; context: Record<string, unknown> }[] = []
  const reporter: MailReporter = {
    warn: (code, context) => warnings.push({ code, context }),
    alert: (code, _err, context) => alerts.push({ code, context }),
    usage: () => {},
  }
  return { reporter, warnings, alerts }
}

const message = (to: string, kind: GateMessage['kind'] = 'everyday'): GateMessage => ({
  kind,
  idempotencyKey: `key-${to}`,
  payload: {
    from: '"A Studio" <noreply@reservetoday.app>',
    to,
    subject: 'hello',
    html: '<p>hello</p>',
    tags: [{ name: 'kind', value: kind }],
  },
})

function setup(script: ResendResponse[] = [], options: { sentToday?: () => Promise<number> } = {}) {
  const clock = fakeClock()
  const resend = fakeResend(clock, script)
  const reports = recordingReporter()
  const gate = createSendGate({
    client: resend.client,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    report: reports.reporter,
    sentToday: options.sentToday ?? (async () => 0),
  })
  return { clock, gate, ...resend, ...reports }
}

/** Start a send and capture how it ended, without awaiting it yet. */
function track<T>(promise: Promise<T>) {
  const outcome: { value?: T; error?: unknown; done: boolean } = { done: false }
  promise.then(
    value => Object.assign(outcome, { value, done: true }),
    error => Object.assign(outcome, { error, done: true }),
  )
  return outcome
}

test('a rate-limit refusal is waited out and delivered once, on one idempotency key', async () => {
  const { clock, gate, calls } = setup([refused('rate_limit_exceeded', 429), refused('rate_limit_exceeded', 429)])
  const sent = track(gate.send(message('a@example.test')))
  await clock.settle()

  assert.equal(sent.error, undefined)
  assert.ok(sent.value?.messageId)
  assert.equal(calls.length, 3, 'two refusals, then one delivery')
  assert.deepEqual(new Set(calls.map(c => c.idempotencyKey)), new Set(['key-a@example.test']))
})

test('retry-after is honoured when Resend sends one', async () => {
  const { clock, gate, calls } = setup([refused('rate_limit_exceeded', 429, { 'retry-after': '7' })])
  track(gate.send(message('a@example.test')))
  await clock.settle()

  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.at - calls[0]!.at, 7000)
})

test('a 5xx or a network failure is retried too', async () => {
  const { clock, gate, calls } = setup([refused('application_error', null), refused('internal_server_error', 500)])
  const sent = track(gate.send(message('a@example.test')))
  await clock.settle()

  assert.equal(sent.error, undefined)
  assert.equal(calls.length, 3)
})

test('retries are bounded', async () => {
  const { clock, gate, calls } = setup(Array.from({ length: 20 }, () => refused('rate_limit_exceeded', 429)))
  const sent = track(gate.send(message('a@example.test')))
  await clock.settle()

  assert.ok(sent.error instanceof Error)
  assert.ok(calls.length > 1 && calls.length < 20, `${calls.length} attempts`)
})

test('a quota refusal is not retried and raises the quota alert', async () => {
  for (const name of ['daily_quota_exceeded', 'monthly_quota_exceeded']) {
    const { clock, gate, calls, alerts } = setup([refused(name, 429, { 'retry-after': '1' })])
    const sent = track(gate.send(message('a@example.test')))
    await clock.settle()

    assert.equal(calls.length, 1, name)
    assert.match(String(sent.error), new RegExp(name))
    assert.deepEqual(alerts.map(a => a.code), ['mail_quota_exhausted'])
  }
})

test('a validation refusal is not retried', async () => {
  const { clock, gate, calls, alerts } = setup([refused('validation_error', 403)])
  const sent = track(gate.send(message('a@example.test')))
  await clock.settle()

  assert.equal(calls.length, 1)
  assert.match(String(sent.error), /resend:validation_error/)
  assert.deepEqual(alerts, [])
})

test('with everyday mail waiting, a credential send goes first', async () => {
  const { clock, gate, calls } = setup()
  for (let i = 0; i < 5; i++) track(gate.send(message(`everyday-${i}@example.test`)))
  track(gate.send(message('code@example.test', 'credential')))
  await clock.settle()

  // The first everyday message was already on its way when the code arrived;
  // everything still waiting lines up behind the code.
  assert.deepEqual(calls.slice(0, 2).map(c => c.to), ['everyday-0@example.test', 'code@example.test'])
  assert.equal(calls.length, 6)
})

test('the pace never exceeds the configured rate', async () => {
  const { clock, gate, calls } = setup()
  const all = Array.from({ length: 40 }, (_, i) => track(gate.send(message(`m${i}@example.test`, i % 3 ? 'everyday' : 'credential'))))
  await clock.settle()

  assert.ok(all.every(s => s.done && !s.error))
  assert.equal(calls.length, 40)
  for (const call of calls) {
    const inWindow = calls.filter(c => c.at >= call.at && c.at < call.at + 1000).length
    assert.ok(inWindow <= 8, `${inWindow} sends in the second starting at ${call.at}`)
  }
})

test('the pace still holds after a rate-limit pause', async () => {
  const { clock, gate, calls } = setup([refused('rate_limit_exceeded', 429, { 'retry-after': '1' })])
  for (let i = 0; i < 20; i++) track(gate.send(message(`m${i}@example.test`)))
  await clock.settle()

  assert.equal(calls.length, 21)
  for (const call of calls) {
    const inWindow = calls.filter(c => c.at >= call.at && c.at < call.at + 1000).length
    assert.ok(inWindow <= 8, `${inWindow} sends in the second starting at ${call.at}`)
  }
})

test('a warning is reported once monthly usage passes 80%', async () => {
  const { clock, gate, warnings } = setup([ok({ 'x-resend-monthly-quota': '2300' }), ok({ 'x-resend-monthly-quota': '2401' }), ok({ 'x-resend-monthly-quota': '2402' })])
  for (let i = 0; i < 3; i++) track(gate.send(message(`m${i}@example.test`)))
  await clock.settle()

  assert.deepEqual(warnings.map(w => w.code), ['mail_quota_monthly_high'])
  assert.equal(warnings[0]!.context.used, 2401)
})

test("a warning is reported once today's sends pass 80 of Free's 100", async () => {
  let count = 78
  const { clock, gate, warnings } = setup([], { sentToday: async () => count++ })
  for (let i = 0; i < 4; i++) track(gate.send(message(`m${i}@example.test`)))
  await clock.settle()

  assert.deepEqual(warnings.map(w => w.code), ['mail_quota_daily_high'])
  assert.equal(warnings[0]!.context.sentToday, 80)
})

test('a failing usage count does not fail the send', async () => {
  const { clock, gate } = setup([], { sentToday: async () => { throw new Error('db down') } })
  const sent = track(gate.send(message('a@example.test')))
  await clock.settle()
  assert.equal(sent.error, undefined)
})
