#!/usr/bin/env node
/**
 * Stop hook: an agent does not get to say "done" over a red suite.
 *
 *   node affected-tests.mjs start   (SessionStart) remembers the commit the session began on
 *   node affected-tests.mjs stop    (Stop)         runs the suites the session touched
 *
 * "Touched" is every file changed since the session began — committed or not,
 * plus new untracked files — so an agent that commits before it stops is still
 * tested. Each suite runs once per state of its files: a suite already green
 * for exactly this diff is not run again, so a turn that changed nothing costs
 * nothing.
 *
 * A red suite blocks the stop (exit 2) and its failures go back to the agent.
 * If the agent is sent back, changes nothing, and stops again, it is let go
 * with a warning to the human instead — a second block would loop forever.
 *
 * State lives in `.claude/.hook-state/` (gitignored), one file per session.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backendTestFiles } from './backend-tests.mjs'

// As CI runs it (deploy-be.yml): serially, in one process. But only the test
// files the change reaches (backend-tests.mjs): CI runs all of it.
const SERIAL_BE =
  'node --import tsx --import ./src/test/environment.ts --test --experimental-test-isolation=none --test-force-exit --test-reporter=spec'

/**
 * Suites in the order they run. `dir` is where the command runs and what it
 * watches. `realDatabase`: skips mean it did not reach Postgres, and only one
 * run at a time may use the checkout's test database.
 */
export const SUITES = [
  {
    id: 'be',
    dir: 'be',
    command: `${SERIAL_BE} <the test files the change reaches>`,
    label: 'backend tests the change reaches (serial, real Postgres)',
    realDatabase: true,
    // Repo paths in; test files relative to `be/` out.
    files: (beDir, paths) =>
      backendTestFiles(beDir, paths.filter((p) => p.startsWith('be/')).map((p) => p.slice('be/'.length))),
  },
  { id: 'fe-client', dir: 'fe-client', command: 'npm run -s check', label: 'fe-client check' },
  { id: 'fe-portal', dir: 'fe-portal', command: 'npm run -s check', label: 'fe-portal check' },
  // Journeys need a deployed stack, so not them: the typecheck, and `--list`,
  // which fails on a skipped journey (src/no-skips-reporter.ts).
  { id: 'e2e', dir: 'e2e', command: 'npm run -s check && npx playwright test --list', label: 'e2e typecheck + skip check' },
  {
    id: 'scripts',
    dir: '.',
    watch: ['scripts/', '.claude/hooks/'],
    command: 'node --test "scripts/*.test.mjs" ".claude/hooks/*.test.mjs"',
    label: 'repo script + hook tests',
  },
]

function watched(suite) {
  return suite.watch ?? [`${suite.dir}/`]
}

/** Docs and ignore files change no behaviour. */
function isCode(path) {
  return !path.endsWith('.md') && !path.endsWith('.gitignore')
}

export function affectedSuites(paths) {
  const code = paths.filter(isCode)
  return SUITES.filter((s) => code.some((p) => watched(s).some((w) => p.startsWith(w))))
}

export function skippedCount(output) {
  return Number(output.match(/^ℹ skipped (\d+)/m)?.[1] ?? 0)
}

const MAX_LINES = 200

export function failureExcerpt(output) {
  const marker = output.lastIndexOf('✖ failing tests:')
  const lines = (marker === -1 ? output : output.slice(marker)).trimEnd().split(/\r?\n/)
  if (lines.length <= MAX_LINES) return lines.join('\n')
  return [`… (${lines.length - MAX_LINES} lines above cut)`, ...lines.slice(-MAX_LINES)].join('\n')
}

/**
 * failures: suites that ran and were red. known: suites red last time and
 * unchanged since, not re-run. stopHookActive: this stop follows one we blocked.
 */
export function decide({ failures, known, stopHookActive }) {
  if (failures.length) return { action: 'block' }
  if (known.length) return stopHookActive ? { action: 'warn', suites: known } : { action: 'block' }
  return { action: 'allow' }
}

// ── Hook entry point ─────────────────────────────────────────────────────────

function git(projectDir, args) {
  // stderr dropped: git's CRLF warnings would land in the message to the agent.
  return execFileSync('git', ['-C', projectDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function statePath(projectDir, sessionId) {
  return join(projectDir, '.claude', '.hook-state', `${String(sessionId).replace(/[^\w-]/g, '_')}.json`)
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeState(file, state) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2))
}

function start(projectDir, input) {
  const file = statePath(projectDir, input.session_id)
  // A resumed or compacted session keeps the commit it first began on.
  if (!readState(file)) writeState(file, { base: git(projectDir, ['rev-parse', 'HEAD']).trim(), green: {}, red: {} })

  const dir = join(file, '..')
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  for (const name of readdirSync(dir)) {
    if (statSync(join(dir, name)).mtimeMs < cutoff) unlinkSync(join(dir, name))
  }
}

/** A hash of everything the suite's code differs by from the session's base. */
function fingerprint(projectDir, base, suite, untracked) {
  const hash = createHash('sha256')
  const exclude = [':(exclude)*.md', ':(exclude)*.gitignore']
  hash.update(git(projectDir, ['diff', '--no-ext-diff', '--binary', base, '--', ...watched(suite), ...exclude]))
  for (const p of untracked.filter((u) => isCode(u) && watched(suite).some((w) => u.startsWith(w)))) {
    hash.update(p)
    hash.update(readFileSync(join(projectDir, p)))
  }
  return hash.digest('hex')
}

// Per checkout: two suites on one test database at once fail each other
// ("tuple concurrently updated") — which reads as red tests nobody broke. Each
// worktree points `TEST_DATABASE_URL` at its own database, so a lock across
// them only made every agent on the machine wait in one line. (The harness
// also holds a per-database lock for each run, whoever started it.)
function dbLock(projectDir) {
  const id = createHash('sha256').update(projectDir.toLowerCase()).digest('hex').slice(0, 12)
  return join(tmpdir(), `reservetoday-test-db-${id}.lock`)
}
const LOCK_WAIT_MS = 25 * 60 * 1000

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Waits for the test database; false if it stayed busy past the wait. */
export function lockDatabase(lock, waitMs = LOCK_WAIT_MS) {
  const giveUp = Date.now() + waitMs
  for (;;) {
    try {
      mkdirSync(lock)
      writeFileSync(join(lock, 'pid'), String(process.pid))
      return true
    } catch {
      // Held. Take it over if its holder is gone (killed mid-run), or never
      // got as far as writing its pid — and try again at once, whatever the
      // clock says: nobody else is waiting on a dead run's lock.
      let holder = 0
      let since = Date.now()
      try {
        since = statSync(lock).mtimeMs
        holder = Number(readFileSync(join(lock, 'pid'), 'utf8'))
      } catch {}
      const orphaned = holder ? !alive(holder) : Date.now() - since > 60_000
      if (orphaned) {
        unlockDatabase(lock)
        continue
      }
      if (Date.now() >= giveUp) return false
      sleep(Math.min(2000, Math.max(giveUp - Date.now(), 0)))
    }
  }
}

export function unlockDatabase(lock) {
  rmSync(lock, { recursive: true, force: true })
}

function run(projectDir, suite, paths) {
  const cwd = join(projectDir, suite.dir)
  if (suite.dir !== '.' && !existsSync(join(cwd, 'node_modules'))) {
    return { ok: false, output: `${suite.dir}/node_modules is missing — run \`npm ci\` in ${suite.dir}/ first.` }
  }
  let command = suite.command
  if (suite.files) {
    const files = suite.files(cwd, paths)
    // Nothing reaches a test (a type, a doc comment, an unused helper): CI has it.
    if (!files.length) return { ok: true, command: '(no test file reaches this change)' }
    command = `${SERIAL_BE} ${files.map((f) => `"${f}"`).join(' ')}`
  }
  const lock = dbLock(projectDir)
  if (suite.realDatabase && !lockDatabase(lock)) {
    return {
      ok: false,
      command,
      output: `Another backend test run held this checkout's test database for ${LOCK_WAIT_MS / 60000} minutes (${lock}). Tell the human.`,
    }
  }
  let result
  try {
    result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } finally {
    if (suite.realDatabase) unlockDatabase(lock)
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) return { ok: false, command, output: failureExcerpt(output) }
  const skipped = skippedCount(output)
  if (suite.realDatabase && skipped > 0) {
    return {
      ok: false,
      command,
      output:
        `${skipped} backend test(s) skipped: the integration suite did not run against Postgres, so a green ` +
        'run proves nothing. Set TEST_DATABASE_URL in be/.env to a scratch database (be/.env.example), ' +
        'or tell the human the backend tests could not run.',
    }
  }
  return { ok: true }
}

function stop(projectDir, input) {
  const file = statePath(projectDir, input.session_id)
  const state = readState(file) ?? { green: {}, red: {} }
  // Started before this hook existed: the session's changes are what is not yet pushed.
  if (!state.base) {
    try {
      state.base = git(projectDir, ['merge-base', 'HEAD', '@{upstream}']).trim()
    } catch {
      state.base = git(projectDir, ['rev-parse', 'HEAD']).trim()
    }
  }

  const changed = git(projectDir, ['diff', '--name-only', '-z', state.base]).split('\0').filter(Boolean)
  const untracked = git(projectDir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  const suites = affectedSuites([...changed, ...untracked])

  const failures = []
  const known = []
  const report = []
  for (const suite of suites) {
    const fp = fingerprint(projectDir, state.base, suite, untracked)
    if (state.green[suite.id] === fp) continue
    if (input.stop_hook_active && state.red[suite.id]?.fp === fp) {
      known.push(suite.id)
      continue
    }
    const result = run(projectDir, suite, [...changed, ...untracked])
    if (result.ok) {
      state.green[suite.id] = fp
      delete state.red[suite.id]
    } else {
      state.red[suite.id] = { fp }
      failures.push(suite.id)
      report.push(`── ${suite.label} (in ${suite.dir}/: ${result.command ?? suite.command}) ──\n${result.output}`)
    }
  }
  writeState(file, state)

  const verdict = decide({ failures, known, stopHookActive: Boolean(input.stop_hook_active) })
  if (verdict.action === 'block') {
    process.stderr.write(
      [
        'Not done yet: tests fail for code this session changed.',
        'Fix the code, not the tests — never skip, loosen or special-case a test to go green.',
        'If you cannot make them pass, say so plainly to the human and stop.',
        '',
        ...report,
      ].join('\n'),
    )
    process.exit(2)
  }
  if (verdict.action === 'warn') {
    process.stdout.write(
      JSON.stringify({
        systemMessage: `Stopped with failing tests: ${verdict.suites.join(', ')}. The agent was shown the failures and changed nothing.`,
      }),
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd
    if (process.argv[2] === 'start') start(projectDir, input)
    else if (process.argv[2] === 'stop') stop(projectDir, input)
  } catch (err) {
    // Not a repo, git missing, a bug here: say so, and do not hold the session.
    process.stderr.write(`affected-tests hook failed: ${err?.stack ?? err}\n`)
    process.exit(1)
  }
}
