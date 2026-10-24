#!/usr/bin/env node
/**
 * The verification stack: a throwaway database, the Stripe stub, the backend,
 * both frontends in dev mode, and one throwaway e2e studio — started, checked
 * and stopped by this one script. See ../SKILL.md.
 *
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs up
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs doctor
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs studio
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs sql "select ..."
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs restart-be
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs down
 *   node .claude/skills/verify-booking-system/scripts/stack.mjs where
 *
 * Every run lives in <tmp>/verify-booking-system/<run-id>/ (state.json, studio.json,
 * logs/, evidence/). `down` never deletes that folder: the evidence outlives the stack.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repo = path.resolve(here, '../../../..')
const be = path.join(repo, 'be')
const beRequire = createRequire(path.join(be, 'package.json'))

export const ROOT = path.join(tmpdir(), 'verify-booking-system')
const CURRENT = path.join(ROOT, 'current.json')

export const DB_NAME = 'reservetoday-verify'
const DB_CONTAINER = 'reservetoday-db'
export const PORTS = { client: 3000, portal: 3001, backend: 4000, stubApi: 12111, stubCheckout: 12443 }
const STUB_API = `http://127.0.0.1:${PORTS.stubApi}`
// The same throwaway values e2e/src/local-stack.ts uses: the key seals only the stub's "key".
const PAYMENT_CREDENTIALS_KEY = Buffer.from('e2e-local-stack-throwaway-key-32').toString('base64')
const STUB_SECRET_KEY = 'sk_test_stripe_stub'
export const SUPER_EMAIL = 'delivered+verify-super@resend.dev'

const tsx = path.join(be, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const nextBin = app => path.join(repo, app, 'node_modules', 'next', 'dist', 'bin', 'next')

// ---------------------------------------------------------------- state

export function currentRunDir() {
  if (!existsSync(CURRENT)) return null
  return JSON.parse(readFileSync(CURRENT, 'utf8')).dir
}

export function readState(dir = currentRunDir()) {
  if (!dir || !existsSync(path.join(dir, 'state.json'))) return null
  return JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'))
}

function writeState(state) {
  writeFileSync(path.join(state.dir, 'state.json'), JSON.stringify(state, null, 2))
}

export function readStudio(state) {
  const file = path.join(state.dir, 'studio.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

// ---------------------------------------------------------------- environment

/** be/.env, then the verification overrides. Built by hand: under NODE_ENV=test the backend does not read be/.env itself. */
function backendEnv(state) {
  const { parse } = beRequire('dotenv')
  const fileVars = parse(readFileSync(path.join(be, '.env')))
  const env = { ...process.env, ...fileVars }
  for (const key of Object.keys(env)) {
    // No real payment or storage key reaches a verification run.
    if (/^(STRIPE_|R2_)/.test(key) || key === 'DATABASE_URL' || key === 'DATABASE_APP_URL') delete env[key]
  }
  return {
    ...env,
    NODE_ENV: 'test', // mail goes to the null transport, and is logged in email_log
    APP_ENV: 'development',
    POSTGRES_DB: DB_NAME,
    DB_APP_PASSWORD: state.appRolePassword,
    STRIPE_API_URL: STUB_API,
    PAYMENT_CREDENTIALS_KEY,
    E2E_STRIPE_SECRET_KEY: STUB_SECRET_KEY,
    PLATFORM_ADMIN_EMAIL: SUPER_EMAIL,
  }
}

// ---------------------------------------------------------------- processes and ports

function listenersOn(port) {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? ''
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      if (cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]))
    }
    return [...pids]
  }
  const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout ?? ''
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))]
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** The process and everything it started — nothing found by name. */
function killTree(pid) {
  if (!pid || !alive(pid)) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
    }
  }
}

function startProcess(state, name, args, { cwd, env }) {
  const log = path.join(state.dir, 'logs', `${name}.log`)
  const fd = openSync(log, 'a')
  const child = spawn(process.execPath, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  child.unref()
  state.pids[name] = child.pid
  writeState(state)
  return log
}

// ---------------------------------------------------------------- http

/** GET with an explicit Host header, so `<slug>.localhost` needs no resolver. */
export function get(url, { host, headers = {}, timeoutMs = 15_000 } = {}) {
  return new Promise(resolve => {
    const u = new URL(url)
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { ...(host ? { host } : {}), ...headers } },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', c => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, body }))
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.on('error', err => resolve({ status: 0, body: String(err) }))
    req.end()
  })
}

async function post(url, data, headers) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }))
  return { ok: res.ok, status: res.status, body: await res.text() }
}

async function waitFor(what, check, timeoutMs, logFile, pid) {
  const until = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < until) {
    if (pid && !alive(pid)) throw new Error(`${what} exited while starting${logFile ? ` — see ${logFile}` : ''}`)
    const result = await check()
    if (result === true) return
    last = result || last
    await new Promise(r => setTimeout(r, 1500))
  }
  throw new Error(`${what} not ready after ${timeoutMs / 1000}s (${last})${logFile ? ` — see ${logFile}` : ''}`)
}

const hostOf = url => new URL(url).host

// ---------------------------------------------------------------- database

function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

function dbContainerRunning() {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', DB_CONTAINER]).trim() === 'true'
  } catch {
    return false
  }
}

function psqlAdmin(sql, database = 'postgres') {
  return docker(['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql])
}

/**
 * The `booking_app` role is shared by every database on the cluster, and a
 * migration rewrites its password. Keep whichever password it has now, so this
 * run does not lock out a test run or a `make dev` backend in another checkout.
 */
async function probeAppRolePassword() {
  const postgres = beRequire('postgres')
  const { parse } = beRequire('dotenv')
  const fileVars = parse(readFileSync(path.join(be, '.env')))
  const port = Number(fileVars.POSTGRES_PORT || 5432)
  const candidates = [...new Set([fileVars.DB_APP_PASSWORD, 'booking_app_dev', 'booking_app_test'].filter(Boolean))]
  for (const password of candidates) {
    const sql = postgres({ host: '127.0.0.1', port, user: 'booking_app', password, database: 'postgres', max: 1, connect_timeout: 5, onnotice: () => {} })
    try {
      await sql`select 1`
      return password
    } catch {
      // the next candidate
    } finally {
      await sql.end({ timeout: 1 })
    }
  }
  return 'booking_app_dev' // no role yet: the migration creates it with this
}

function runStep(state, name, args, env) {
  const log = path.join(state.dir, 'logs', `${name}.log`)
  const r = spawnSync(process.execPath, args, { cwd: be, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}`)
  if (r.status !== 0) throw new Error(`${name} failed (exit ${r.status}) — see ${log}`)
  return r.stdout ?? ''
}

// ---------------------------------------------------------------- git

/** HEAD for the record; the backend is stale only when be/src itself differs (committed tree, edits, new files). */
function sourceFingerprint() {
  const git = args => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout ?? ''
  const head = git(['rev-parse', 'HEAD']).trim()
  const beSrc = createHash('sha1')
    .update(git(['rev-parse', 'HEAD:be/src']))
    .update(git(['diff', 'HEAD', '--', 'be/src']))
    .update(git(['ls-files', '--others', '--exclude-standard', '--', 'be/src']))
    .digest('hex')
  return { head, beSrc }
}

// ---------------------------------------------------------------- commands

async function up() {
  const existing = readState()
  if (existing && !existing.stopped) {
    throw new Error(`a verification stack is already recorded at ${existing.dir} — run \`stack.mjs doctor\`, or \`stack.mjs down\` first`)
  }
  const busy = Object.entries(PORTS).map(([name, port]) => [name, port, listenersOn(port)]).filter(([, , pids]) => pids.length)
  if (busy.length) {
    throw new Error(
      `ports in use, and not by a stack this script started — stop them yourself or ask the human (never kill by name):\n` +
        busy.map(([name, port, pids]) => `  ${name} :${port} pid ${pids.join(',')}`).join('\n'),
    )
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomBytes(2).toString('hex')}`
  const dir = path.join(ROOT, runId)
  for (const d of ['logs', 'evidence']) mkdirSync(path.join(dir, d), { recursive: true })
  writeFileSync(CURRENT, JSON.stringify({ dir }))
  const state = { runId, dir, repo, startedAt: new Date().toISOString(), source: sourceFingerprint(), db: DB_NAME, startedDbContainer: false, pids: {}, listeners: {}, stopped: false }
  writeState(state)
  const say = msg => console.log(`[verify] ${msg}`)
  say(`run ${runId} → ${dir}`)

  if (!dbContainerRunning()) {
    say('starting the Postgres container (docker compose)…')
    execFileSync('docker', ['compose', '--env-file', 'be/.env', 'up', '-d', '--wait'], { cwd: repo, stdio: 'ignore' })
    state.startedDbContainer = true
    writeState(state)
  }
  say(`fresh database ${DB_NAME}…`)
  psqlAdmin(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
  psqlAdmin(`CREATE DATABASE "${DB_NAME}"`)
  state.appRolePassword = await probeAppRolePassword()
  state.super = { email: SUPER_EMAIL, password: `verify-${randomBytes(9).toString('base64url')}` }
  writeState(state)
  const env = backendEnv(state)

  say('migrate, seed, super portal password…')
  runStep(state, 'migrate', [tsx, 'src/db/migrate.ts'], env)
  runStep(state, 'seed', [tsx, 'src/db/seed/run.ts'], env)
  runStep(state, 'super-admin', [tsx, path.join(here, 'super-admin.ts')], { ...env, VERIFY_SUPER_PASSWORD: state.super.password })

  say('Stripe stub…')
  const stubLog = startProcess(state, 'stub', [tsx, path.join(here, 'stripe-stub.ts')], { cwd: be, env })
  await waitFor('Stripe stub', async () => ((await get(`${STUB_API}/v1/account`)).status === 200 ? true : 'no answer'), 60_000, stubLog, state.pids.stub)

  say('backend :4000…')
  const beLog = startProcess(state, 'backend', [tsx, 'src/server.ts'], { cwd: be, env })
  await waitFor('backend', async () => {
    const r = await get(`http://127.0.0.1:${PORTS.backend}/health`)
    return r.status === 200 && JSON.parse(r.body).db === 'ok' ? true : `health ${r.status}`
  }, 120_000, beLog, state.pids.backend)

  say('throwaway studio (e2e:studio setup)…')
  const studio = makeStudio(state, 'studio.json')
  state.studioSlug = studio.slug
  writeState(state)

  say('member app :3000 and portal :3001 (next dev; the first compile is slow)…')
  const clientLog = startProcess(state, 'client', [nextBin('fe-client'), 'dev', '--webpack', '-p', String(PORTS.client)], { cwd: path.join(repo, 'fe-client'), env: { ...process.env, NODE_ENV: 'development' } })
  const portalLog = startProcess(state, 'portal', [nextBin('fe-portal'), 'dev', '--webpack', '-p', String(PORTS.portal)], { cwd: path.join(repo, 'fe-portal'), env: { ...process.env, NODE_ENV: 'development' } })
  // Each page compiles on first request; warm the ones every drive starts from.
  await waitFor('member app', async () => ((await get(`http://127.0.0.1:${PORTS.client}/`, { host: hostOf(studio.urls.client), timeoutMs: 180_000 })).status === 200 ? true : 'not 200'), 300_000, clientLog, state.pids.client)
  await waitFor('staff portal', async () => ((await get(`http://127.0.0.1:${PORTS.portal}/login`, { host: hostOf(studio.urls.portal), timeoutMs: 180_000 })).status === 200 ? true : 'not 200'), 300_000, portalLog, state.pids.portal)
  await waitFor('super portal', async () => ((await get(`http://127.0.0.1:${PORTS.portal}/login`, { host: `admin.portal.localhost:${PORTS.portal}`, timeoutMs: 180_000 })).status === 200 ? true : 'not 200'), 300_000, portalLog, state.pids.portal)

  for (const [name, port] of Object.entries(PORTS)) state.listeners[name] = listenersOn(port)
  writeState(state)

  const ok = await doctor({ quiet: true })
  console.log('')
  console.log(`  run dir       ${dir}`)
  console.log(`  evidence      ${path.join(dir, 'evidence')}`)
  console.log(`  studio        ${studio.slug}  (${path.join(dir, 'studio.json')})`)
  console.log(`  member app    ${studio.urls.client}`)
  console.log(`  staff portal  ${studio.urls.portal}/login   admin ${studio.staff.admin.email}`)
  console.log(`  super portal  http://admin.portal.localhost:${PORTS.portal}/login   ${SUPER_EMAIL}`)
  console.log(`  passwords     in ${path.join(dir, 'state.json')} (super) and studio.json (staff, members)`)
  console.log('')
  if (!ok) throw new Error('up finished but doctor failed — read the lines above')
  console.log('[verify] READY')
}

/** `e2e:studio setup` against the verification database; the studio's JSON is saved as `file` in the run dir. */
function makeStudio(state, file) {
  const out = runStep(state, file.replace('.json', ''), [tsx, 'src/e2e/cli.ts', 'setup'], backendEnv(state))
  const line = out.split(/\r?\n/).find(l => l.startsWith('E2E_STUDIO='))
  if (!line) throw new Error(`the studio command printed no E2E_STUDIO line — see ${path.join(state.dir, 'logs', file.replace('.json', '.log'))}`)
  const studio = JSON.parse(line.slice('E2E_STUDIO='.length))
  writeFileSync(path.join(state.dir, file), JSON.stringify(studio, null, 2))
  return studio
}

/** Another studio in the same run, for tenancy checks: studio-2.json, studio-3.json, … */
function anotherStudio() {
  const state = readState()
  if (!state || state.stopped) throw new Error('no running verification stack recorded')
  let n = 2
  while (existsSync(path.join(state.dir, `studio-${n}.json`))) n++
  const studio = makeStudio(state, `studio-${n}.json`)
  console.log(`[verify] studio ${studio.slug} → ${path.join(state.dir, `studio-${n}.json`)} (drive scripts: loadStudio(${n}))`)
}

async function doctor({ quiet = false } = {}) {
  const state = readState()
  const lines = []
  let ok = true
  const check = (good, label, detail = '') => {
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
    if (!good) ok = false
  }
  if (!state || state.stopped) {
    console.log('FAIL no running verification stack recorded — run `stack.mjs up`')
    return false
  }
  const studio = readStudio(state)
  check(dbContainerRunning(), `database container ${DB_CONTAINER} running`)
  for (const name of ['stub', 'backend', 'client', 'portal']) check(alive(state.pids[name]), `${name} pid ${state.pids[name]} alive`)
  for (const [name, port] of Object.entries(PORTS)) {
    const now = listenersOn(port).sort().join(',')
    const recorded = (state.listeners[name] ?? []).sort().join(',')
    check(now !== '' && now === recorded, `:${port} (${name}) held by this run's process`, now === recorded ? '' : `now ${now || 'nothing'}, recorded ${recorded || 'nothing'}`)
  }
  const health = await get(`http://127.0.0.1:${PORTS.backend}/health`)
  check(health.status === 200 && health.body.includes('"db":"ok"'), 'backend /health db ok', `${health.status}`)
  check((await get(`${STUB_API}/v1/account`)).status === 200, 'Stripe stub answers')
  if (studio) {
    const headers = { 'x-tenant-slug': studio.slug, origin: studio.urls.client }
    const classes = await get(`http://127.0.0.1:${PORTS.backend}/api/v1/public/classes`, { headers })
    check(classes.status === 200 && classes.body.includes(studio.classes.buy.id), `backend serves studio ${studio.slug} from ${DB_NAME}`, `${classes.status}`)
    const signIn = await post(`http://127.0.0.1:${PORTS.backend}/api/v1/auth/staff/sign-in/email`, { email: studio.staff.admin.email, password: studio.staff.password }, { 'x-tenant-slug': studio.slug, origin: studio.urls.portal })
    check(signIn.ok, 'studio admin can sign in', `${signIn.status}`)
    check((await get(`http://127.0.0.1:${PORTS.client}/`, { host: hostOf(studio.urls.client), timeoutMs: 120_000 })).status === 200, `member app answers for ${hostOf(studio.urls.client)}`)
    check((await get(`http://127.0.0.1:${PORTS.portal}/login`, { host: hostOf(studio.urls.portal), timeoutMs: 120_000 })).status === 200, `staff portal answers for ${hostOf(studio.urls.portal)}`)
  } else check(false, 'studio.json present')
  const stubLog = path.join(state.dir, 'logs', 'stub.log')
  const unhandled = existsSync(stubLog) ? readFileSync(stubLog, 'utf8').split(/\r?\n/).filter(l => l.includes('UNHANDLED')) : []
  check(unhandled.length === 0, 'Stripe stub saw no call it does not play', unhandled.slice(-3).join(' | '))
  const now = sourceFingerprint()
  const stale = now.beSrc !== state.source.beSrc
  lines.push(`${stale ? 'warn' : 'ok  '} backend runs the current be/src${stale ? ' — be/src changed since it started: `stack.mjs restart-be` (a new migration needs down + up)' : ''}`)
  if (now.head !== state.source.head) lines.push(`note HEAD moved since up (${state.source.head.slice(0, 8)} → ${now.head.slice(0, 8)}); the frontends hot-reload, the backend does not`)
  if (!quiet || !ok) console.log(lines.join('\n'))
  return ok
}

async function restartBackend() {
  const state = readState()
  if (!state || state.stopped) throw new Error('no running verification stack recorded')
  killTree(state.pids.backend)
  await waitFor('port 4000 to free', async () => (listenersOn(PORTS.backend).length ? 'held' : true), 30_000)
  const log = startProcess(state, 'backend', [tsx, 'src/server.ts'], { cwd: be, env: backendEnv(state) })
  await waitFor('backend', async () => ((await get(`http://127.0.0.1:${PORTS.backend}/health`)).status === 200 ? true : 'no health'), 120_000, log)
  state.listeners.backend = listenersOn(PORTS.backend)
  state.source = sourceFingerprint()
  writeState(state)
  console.log('[verify] backend restarted')
}

async function down() {
  const state = readState()
  if (!state) return console.log('[verify] nothing recorded; nothing to stop')
  for (const name of ['client', 'portal', 'backend', 'stub']) killTree(state.pids[name])
  for (const [name, port] of Object.entries(PORTS)) {
    const recorded = new Set(state.listeners[name] ?? [])
    const left = listenersOn(port).filter(pid => recorded.has(pid))
    for (const pid of left) killTree(pid)
  }
  if (dbContainerRunning()) {
    try {
      psqlAdmin(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
    } catch (err) {
      console.warn(`[verify] could not drop ${DB_NAME}: ${String(err.message).split('\n')[0]}`)
    }
    if (state.startedDbContainer) docker(['stop', DB_CONTAINER])
  }
  state.stopped = true
  state.stoppedAt = new Date().toISOString()
  writeState(state)
  console.log(`[verify] stopped. Evidence kept at ${path.join(state.dir, 'evidence')}`)
}

function sql(query) {
  if (!query) throw new Error('usage: stack.mjs sql "<select …>"')
  // Read-only: evidence is looked at, never written.
  const out = docker(['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', DB_NAME, '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-c', query])
  process.stdout.write(out)
}

function where() {
  const state = readState()
  if (!state) return console.log('no run recorded')
  console.log(JSON.stringify({ dir: state.dir, evidence: path.join(state.dir, 'evidence'), stopped: state.stopped, studio: state.studioSlug }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const commands = { up, doctor: async () => process.exit((await doctor()) ? 0 : 1), down, 'restart-be': restartBackend, studio: anotherStudio, sql: () => sql(rest.join(' ')), where }
  const run = commands[command]
  if (!run) {
    console.error('usage: stack.mjs up | doctor | studio | sql "<query>" | restart-be | down | where')
    process.exit(2)
  }
  Promise.resolve(run()).catch(err => {
    console.error(`[verify] ${err.message}`)
    process.exit(1)
  })
}
