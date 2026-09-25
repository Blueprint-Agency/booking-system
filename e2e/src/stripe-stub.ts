import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Stripe, played by this process, for the journeys a pull request runs on the
 * CI runner (#207). Nothing in such a run reaches real Stripe:
 *
 *  - The backend's Stripe client is pointed here by `STRIPE_API_URL`
 *    (be/src/lib/stripe-endpoint.ts), and is answered the few calls a checkout
 *    makes — a Customer, a session, the session read back, the intent's receipt
 *    — plus the account lookup and webhook endpoint the run's studio is set up
 *    with when it is given its own account (./local-stack.ts).
 *  - The browser still goes to `https://checkout.stripe.com/…`, but its
 *    resolver maps every Stripe host to the page served here
 *    (`STRIPE_HOST_RULES`), which asks for a card the way Stripe's does — a
 *    "Card number" box, expiry, CVC, cardholder name and a "Pay" button — so a
 *    journey pays the same way against this and against Stripe's own page.
 *
 * Stripe's test cards mean what they mean there: 4242 4242 4242 4242 pays,
 * 4000 0000 0000 0002 is declined, anything else is not a card. Paid, the page
 * sends the browser to the session's `success_url`, and the session reads back
 * as paid — which is what the confirmation page's sync grants on.
 *
 * Anything asked of it that it does not know is answered 404 and remembered;
 * `unhandled` is how a run says a new Stripe call needs playing here, rather
 * than letting a journey fail somewhere downstream for a reason nobody can see.
 */
export const STRIPE_STUB_API_PORT = 12111
export const STRIPE_STUB_CHECKOUT_PORT = 12443
// An address, not `localhost`: Node may resolve that to ::1, where nothing listens.
export const STRIPE_STUB_API_URL = `http://127.0.0.1:${STRIPE_STUB_API_PORT}`

/** Chromium's resolver rules: every Stripe host is this stub's checkout page. */
export const STRIPE_HOST_RULES = ['stripe.com', '*.stripe.com', '*.stripe.network']
  .map(host => `MAP ${host} 127.0.0.1:${STRIPE_STUB_CHECKOUT_PORT}`)
  .join(', ')

type Session = {
  id: string
  object: 'checkout.session'
  mode: 'payment'
  status: 'open' | 'complete' | 'expired'
  payment_status: 'unpaid' | 'paid'
  amount_total: number
  currency: string
  customer: string | null
  customer_email: string | null
  metadata: Record<string, string>
  payment_intent: string | null
  success_url: string
  cancel_url: string
  url: string
  expires_at: number
}

export type StripeStub = { unhandled: string[]; close: () => Promise<void> }

type Form = { [key: string]: string | Form }

/** Stripe's bracketed form keys (`metadata[client_id]`, `line_items[0][quantity]`) as objects. */
function nested(params: URLSearchParams): Form {
  const out: Form = {}
  for (const [key, value] of params) {
    const parts = key.replace(/\]/g, '').split('[')
    let node = out
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = value
      else node = (node[part] ??= {}) as Form
    })
  }
  return out
}

const id = (prefix: string) => `${prefix}_stub_${randomBytes(12).toString('hex')}`

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function checkoutPage(session: Session, error?: string): string {
  const amount = `S$${(session.amount_total / 100).toFixed(2)}`
  const field = (label: string, name: string, autocomplete: string) =>
    `<label>${label}<input name="${name}" autocomplete="${autocomplete}" required></label>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Checkout (Stripe stub)</title>
<style>body{font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.75rem 0}input{display:block;width:100%;padding:.5rem;margin-top:.25rem}button{margin-top:1rem;padding:.75rem;width:100%}[role=alert]{color:#b00}</style>
</head><body>
<p>Stripe stub — no real payment is taken.</p>
<h1>Pay ${escape(amount)}</h1>
${error ? `<p role="alert">${escape(error)}</p>` : ''}
<form method="post">
${field('Card number', 'number', 'cc-number')}
${field('Expiration date (MM / YY)', 'expiry', 'cc-exp')}
${field('CVC', 'cvc', 'cc-csc')}
${field('Cardholder name', 'name', 'cc-name')}
<button type="submit">Pay</button>
</form>
<p><a href="${escape(session.cancel_url)}">Back</a></p>
</body></html>`
}

/**
 * A certificate for the checkout page. The browser runs with certificate errors
 * ignored (only when this stub is in use), so any pair will do; it is made per
 * run so no private key lives in the repository. On Windows `openssl` is
 * usually only Git's, and not on PATH.
 */
function certificate(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), 'stripe-stub-'))
  const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=checkout.stripe.com',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')]
  const candidates = [process.env.E2E_OPENSSL ?? 'openssl']
  if (process.platform === 'win32') {
    const gitExec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
    candidates.push(path.resolve(gitExec, '../../bin/openssl.exe'), path.resolve(gitExec, '../../../usr/bin/openssl.exe'))
  }
  try {
    for (const openssl of candidates) {
      try {
        execFileSync(openssl, args, { stdio: 'ignore' })
        return { key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }
      } catch {
        // the next candidate
      }
    }
    throw new Error(`the Stripe stub needs openssl for its certificate; tried ${candidates.join(', ')} (set E2E_OPENSSL)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function startStripeStub(): Promise<StripeStub> {
  const sessions = new Map<string, Session>()
  const unhandled: string[] = []
  const notFound = (req: http.IncomingMessage, res: http.ServerResponse) => {
    unhandled.push(`${req.method} ${req.headers.host}${req.url}`)
    json(res, 404, { error: { type: 'invalid_request_error', message: `the Stripe stub does not play ${req.method} ${req.url}` } })
  }

  const api = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', STRIPE_STUB_API_URL)
    const form = nested(new URLSearchParams(req.method === 'GET' ? '' : await readBody(req)))
    const route = `${req.method} ${url.pathname}`
    let match: RegExpMatchArray | null

    // The studio command sets the studio's account up as the super portal does
    // (#294): the key proved, the account id this answers with stored, and the
    // studio's webhook endpoint made there. Nothing is ever delivered to it —
    // the confirmation page's sync is what grants in a journey.
    if (route === 'GET /v1/account') {
      return json(res, 200, { id: 'acct_stripe_stub', object: 'account' })
    }
    if (route === 'GET /v1/webhook_endpoints') {
      return json(res, 200, { object: 'list', data: [], has_more: false, url: '/v1/webhook_endpoints' })
    }
    if (route === 'POST /v1/webhook_endpoints') {
      return json(res, 200, {
        id: id('we'),
        object: 'webhook_endpoint',
        url: form.url,
        enabled_events: Object.values((form.enabled_events ?? {}) as Form),
        metadata: form.metadata ?? {},
        secret: id('whsec'),
      })
    }
    if (route === 'POST /v1/customers') {
      return json(res, 200, { id: id('cus'), object: 'customer', email: form.email ?? null, metadata: form.metadata ?? {} })
    }
    if ((match = route.match(/^(POST|DELETE) \/v1\/customers\/([^/]+)$/))) {
      return json(res, 200, { id: match[2], object: 'customer', ...(match[1] === 'DELETE' ? { deleted: true } : {}) })
    }
    if (route === 'GET /v1/payment_methods') {
      return json(res, 200, { object: 'list', data: [], has_more: false, url: '/v1/payment_methods' })
    }
    if (route === 'POST /v1/checkout/sessions') {
      const lines = Object.values((form.line_items ?? {}) as Form) as Form[]
      const amount = lines.reduce((sum, line) => {
        const price = line.price_data as Form | undefined
        return sum + Number(price?.unit_amount ?? 0) * Number(line.quantity ?? 1)
      }, 0)
      const sessionId = id('cs_test')
      const session: Session = {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        status: 'open',
        payment_status: 'unpaid',
        amount_total: amount,
        currency: 'sgd',
        customer: (form.customer as string | undefined) ?? null,
        customer_email: (form.customer_email as string | undefined) ?? null,
        metadata: (form.metadata ?? {}) as Record<string, string>,
        payment_intent: null,
        success_url: String(form.success_url),
        cancel_url: String(form.cancel_url),
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
        expires_at: Number(form.expires_at ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60),
      }
      sessions.set(sessionId, session)
      return json(res, 200, session)
    }
    if ((match = route.match(/^GET \/v1\/checkout\/sessions\/([^/]+)$/)) && sessions.has(match[1]!)) {
      return json(res, 200, sessions.get(match[1]!))
    }
    if ((match = route.match(/^POST \/v1\/checkout\/sessions\/([^/]+)\/expire$/)) && sessions.has(match[1]!)) {
      const session = sessions.get(match[1]!)!
      if (session.status === 'open') session.status = 'expired'
      return json(res, 200, session)
    }
    if ((match = route.match(/^GET \/v1\/payment_intents\/([^/]+)$/))) {
      const session = [...sessions.values()].find(s => s.payment_intent === match![1])
      if (session) {
        return json(res, 200, {
          id: session.payment_intent,
          object: 'payment_intent',
          amount: session.amount_total,
          currency: session.currency,
          status: 'succeeded',
          metadata: session.metadata,
          latest_charge: { id: id('ch'), object: 'charge', receipt_url: null },
        })
      }
    }
    return notFound(req, res)
  })

  const checkout = https.createServer(certificate(), async (req, res) => {
    const url = new URL(req.url ?? '/', 'https://checkout.stripe.com')
    if (url.pathname === '/favicon.ico') return void res.writeHead(204).end()
    const match = url.pathname.match(/^\/c\/pay\/([^/]+)$/)
    const session = match && req.headers.host?.startsWith('checkout.stripe.com') ? sessions.get(match[1]!) : undefined
    if (!session) return notFound(req, res)
    const page = (status: number, error?: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(checkoutPage(session, error))
    }
    if (session.status === 'expired') return page(410, 'This checkout session has expired.')
    if (session.status === 'complete') return void res.writeHead(303, { Location: successUrl(session) }).end()
    if (req.method !== 'POST') return page(200)

    const card = Object.fromEntries(new URLSearchParams(await readBody(req)))
    if (!card.expiry?.trim() || !card.cvc?.trim() || !card.name?.trim()) return page(402, 'Your card details are incomplete.')
    const number = (card.number ?? '').replace(/\D/g, '')
    if (number === '4000000000000002') return page(402, 'Your card was declined.')
    if (number !== '4242424242424242') return page(402, 'Your card number is invalid.')

    session.status = 'complete'
    session.payment_status = 'paid'
    session.payment_intent = id('pi')
    res.writeHead(303, { Location: successUrl(session) }).end()
  })

  await Promise.all([
    new Promise<void>((resolve, reject) => api.once('error', reject).listen(STRIPE_STUB_API_PORT, '127.0.0.1', resolve)),
    new Promise<void>((resolve, reject) => checkout.once('error', reject).listen(STRIPE_STUB_CHECKOUT_PORT, '127.0.0.1', resolve)),
  ])
  console.log(
    `[e2e] Stripe stub: API ${STRIPE_STUB_API_URL}, checkout on 127.0.0.1:${(checkout.address() as AddressInfo).port}`,
  )

  return {
    unhandled,
    close: async () => {
      for (const server of [api, checkout]) {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    },
  }
}

const successUrl = (session: Session) => session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id)
