#!/usr/bin/env node
/**
 * Run one drive script in a real Chromium against the running verification
 * stack, and keep its evidence. See ../SKILL.md § Drive.
 *
 *   node .claude/skills/verify-booking-system/scripts/drive.mjs <drive-script.mjs> [--name <label>] [--headed]
 *
 * The drive script is an ES module whose default export receives one object:
 *
 *   export default async ({ page, context, browser, studio, state, signInMember, signInStaff,
 *                           signInSuper, visitSignedOut, newPage, loadStudio, step, shot, aria, sql, save, expect }) => { … }
 *
 * Evidence lands in <run>/evidence/<label>-<time>/: steps.log, a screenshot and
 * an ARIA snapshot per `shot`/`aria`, sql-*.txt per `sql`, console.log,
 * network.log (every API response ≥ 400 and every failed request), trace.zip
 * (open with `npx --prefix e2e playwright show-trace <path>`), and result.json.
 * A thrown error fails the drive (exit 1) after a failure screenshot and the trace are saved.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DB_NAME, readState, readStudio, repo } from './stack.mjs'

const e2eRequire = createRequire(path.join(repo, 'e2e', 'package.json'))
const { chromium, expect } = e2eRequire('@playwright/test')

// e2e/src/stripe-stub.ts: every Stripe host is the stub's checkout page.
const STRIPE_HOST_RULES = ['stripe.com', '*.stripe.com', '*.stripe.network'].map(h => `MAP ${h} 127.0.0.1:12443`).join(', ')

const args = process.argv.slice(2)
const scriptPath = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--name')
const label = args.includes('--name') ? args[args.indexOf('--name') + 1] : path.basename(scriptPath ?? 'drive', '.mjs')
const headed = args.includes('--headed')
if (!scriptPath) {
  console.error('usage: drive.mjs <drive-script.mjs> [--name <label>] [--headed]')
  process.exit(2)
}

const state = readState()
if (!state || state.stopped) {
  console.error('[drive] no running verification stack — run `stack.mjs up`, then `stack.mjs doctor`')
  process.exit(1)
}
const studio = readStudio(state)
const out = path.join(state.dir, 'evidence', `${label}-${new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)}`)
mkdirSync(out, { recursive: true })

const log = line => {
  const stamped = `${new Date().toISOString()} ${line}`
  appendFileSync(path.join(out, 'steps.log'), `${stamped}\n`)
  console.log(line)
}
let shots = 0
const slug = name => `${String(++shots).padStart(2, '0')}-${name.replace(/[^a-z0-9-]+/gi, '-')}`

const browser = await chromium.launch({ headless: !headed, args: [`--host-resolver-rules=${STRIPE_HOST_RULES}`] })
const contextOptions = { ignoreHTTPSErrors: true, timezoneId: 'Asia/Singapore', locale: 'en-SG', viewport: { width: 1280, height: 900 } }
const context = await browser.newContext(contextOptions)
await context.tracing.start({ screenshots: true, snapshots: true, sources: false })

/** Watch a page: console errors and API failures go to the evidence. */
function watch(page) {
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') appendFileSync(path.join(out, 'console.log'), `[${m.type()}] ${page.url()} ${m.text()}\n`)
  })
  page.on('pageerror', e => appendFileSync(path.join(out, 'console.log'), `[pageerror] ${page.url()} ${e.message}\n`))
  page.on('response', r => {
    if (r.status() >= 400 && r.url().startsWith(studio.urls.api)) appendFileSync(path.join(out, 'network.log'), `${r.status()} ${r.request().method()} ${r.url()}\n`)
  })
  page.on('requestfailed', r => appendFileSync(path.join(out, 'network.log'), `FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText}\n`))
  return page
}

/**
 * An address of the page's own for API calls (e2e/src/studio.ts `ownAddress`):
 * the backend rate-limits per client address, and every browser here is one machine.
 */
async function ownAddress(page) {
  const n = randomBytes(2)
  const address = `198.18.${n[0]}.${n[1]}`
  await page.route(`${studio.urls.api}/**`, route => route.fallback({ headers: { ...route.request().headers(), 'x-forwarded-for': address } }))
}

const helpers = {
  page: watch(await context.newPage()),
  context,
  browser,
  studio,
  state,
  expect,
  /** A fresh context and page (another person on another device), watched and traced like the first. */
  async newPage() {
    const ctx = await browser.newContext(contextOptions)
    await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false })
    extraContexts.push(ctx)
    return watch(await ctx.newPage())
  },
  /** A member with a session token, as fe-client/src/lib/member-auth.ts keeps one. Call before the first goto. */
  async signInMember(page, member) {
    await ownAddress(page)
    await page.addInitScript(([origin, token]) => {
      if (window.location.origin === origin) window.localStorage.setItem('rt.client.session', token)
    }, [studio.urls.client, member.token])
  },
  async visitSignedOut(page) {
    await ownAddress(page)
  },
  /** Staff sign-in through the portal's own form: email, Continue, password, Sign in. */
  async signInStaff(page, person) {
    await ownAddress(page)
    await page.goto(`${studio.urls.portal}/login`)
    await page.getByLabel('Email').fill(person.email)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('textbox', { name: 'Password' }).fill(studio.staff.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  },
  /** The super portal operator, with the password stack.mjs gave them. */
  async signInSuper(page) {
    await ownAddress(page)
    await page.goto('http://admin.portal.localhost:3001/login')
    await page.getByLabel('Email').fill(state.super.email)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('textbox', { name: 'Password' }).fill(state.super.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  },
  /** Another studio made by `stack.mjs studio` (2 → studio-2.json), for tenancy checks. */
  loadStudio(n) {
    const file = path.join(state.dir, `studio-${n}.json`)
    if (!existsSync(file)) throw new Error(`no ${file} — run \`stack.mjs studio\` first`)
    return JSON.parse(readFileSync(file, 'utf8'))
  },
  step: msg => log(`STEP ${msg}`),
  /** A full-page screenshot. */
  async shot(name, page = helpers.page) {
    const file = path.join(out, `${slug(name)}.png`)
    await page.screenshot({ path: file, fullPage: true })
    log(`shot ${file}`)
    return file
  },
  /** The ARIA snapshot of the page (or a locator): what a screen reader, and an assertion, sees. */
  async aria(name, target = helpers.page) {
    const locator = 'locator' in target && 'goto' in target ? target.locator('body') : target
    const file = path.join(out, `${slug(name)}.aria.yml`)
    writeFileSync(file, `# ${helpers.page.url()}\n${await locator.ariaSnapshot()}`)
    log(`aria ${file}`)
    return file
  },
  /** A read-only query on the verification database, saved as evidence and returned as text. */
  sql(name, query) {
    const r = spawnSync('docker', ['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'reservetoday-db', 'psql', '-U', 'postgres', '-d', DB_NAME, '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
    const text = `-- ${query}\n${r.stdout}${r.stderr}`
    const file = path.join(out, `sql-${slug(name)}.txt`)
    writeFileSync(file, text)
    log(`sql ${file}`)
    if (r.status !== 0) throw new Error(`sql ${name} failed: ${r.stderr}`)
    return r.stdout
  },
  save(name, data) {
    const file = path.join(out, name)
    writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    log(`saved ${file}`)
    return file
  },
}
const extraContexts = []

let failure = null
log(`drive ${path.resolve(scriptPath)} → ${out}`)
log(`studio ${studio.slug} · HEAD ${state.source.head}`)
try {
  const mod = await import(pathToFileURL(path.resolve(scriptPath)).href)
  await mod.default(helpers)
} catch (err) {
  failure = err
  log(`FAILED ${err.stack ?? err}`)
  await helpers.page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
}
await context.tracing.stop({ path: path.join(out, 'trace.zip') })
for (const [i, ctx] of extraContexts.entries()) await ctx.tracing.stop({ path: path.join(out, `trace-${i + 2}.zip`) }).catch(() => {})
await browser.close()
writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, script: path.resolve(scriptPath), ok: !failure, error: failure ? String(failure.message ?? failure) : null, head: state.source.head, studio: studio.slug, finishedAt: new Date().toISOString() }, null, 2))
log(failure ? `RESULT fail — evidence in ${out}` : `RESULT pass — evidence in ${out}`)
process.exit(failure ? 1 : 0)
