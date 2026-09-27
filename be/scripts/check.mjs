/**
 * `npm run check`: the backend test run, the one command CI and the stop hook
 * use too, so a local run and CI's cannot drift apart.
 *
 * Serially, in one process (`--experimental-test-isolation=none`, the spelling
 * Node 22 accepts), with the test environment put in place before any file
 * loads (`src/test/environment.ts`) — see docs/md/testing.md § Running the
 * backend tests.
 *
 * A wrapper rather than one `node` line in package.json because `node --test`
 * stops reading options at its first file pattern: flags appended by
 * `npm run check -- <flags>` would land after the patterns and be ignored. Here
 * every argument that starts with `-` goes before the patterns (write a value
 * with `=`: `--test-reporter=tap`), and any other argument is a test file that
 * replaces the default patterns:
 *
 *   npm run check
 *   npm run check -- --test-reporter=tap
 *   npm run check -- src/test/refunds.test.ts
 *
 * It refuses to start where a green run would not predict CI's: on a Node
 * major other than `.nvmrc`'s, or with no `TEST_DATABASE_URL` (the integration
 * tests would skip). A full run — no test files named — starts from an empty
 * database, as CI's does: it drops and recreates the checkout's test database
 * first. CI's own database is new with every job, so there it is left alone.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import { prepareTestDatabase, resetRefusal } from './test-db.mjs'

export const BASE_FLAGS = [
  '--import',
  'tsx',
  '--import',
  './src/test/environment.ts',
  '--test',
  '--experimental-test-isolation=none',
  '--test-force-exit',
]

export const DEFAULT_PATTERNS = ['src/**/*.test.ts', 'tools/**/*.test.ts', 'scripts/**/*.test.mjs']

/**
 * The `node` arguments for `npm run check -- <args>`. Refuses an argument that
 * is neither a flag nor a test file: it is almost certainly a flag's value
 * written after a space, which would otherwise run as a pattern matching
 * nothing, in place of the whole suite.
 */
export function nodeArgs(args) {
  const flags = args.filter(a => a.startsWith('-'))
  const files = args.filter(a => !a.startsWith('-'))
  const stray = files.filter(f => !/\.test\.(ts|mjs)$/.test(f))
  if (stray.length) {
    throw new Error(`not a test file: ${stray.join(', ')} (write a flag's value with =, e.g. --test-reporter=tap)`)
  }
  return [...BASE_FLAGS, ...flags, ...(files.length ? files : DEFAULT_PATTERNS)]
}

/**
 * Why Node `version` must not run the suite, or null when it may. CI and
 * be/Dockerfile run the major `.nvmrc` names, and another major accepts flags
 * and behaves in ways that one does not.
 */
export function nodeRefusal(version, nvmrc) {
  const major = v => v.trim().replace(/^v/, '').split('.')[0]
  const wanted = major(nvmrc)
  if (major(version) === wanted) return null
  return `this is Node ${version}, and CI runs Node ${wanted} (.nvmrc): switch first (nvm use ${wanted})`
}

/** The test database a run would use: the shell's, else `be/.env`'s, as `src/test/environment.ts` reads it. */
export function testDatabaseUrl(env, dotenvText) {
  return env.TEST_DATABASE_URL?.trim() || parse(dotenvText).TEST_DATABASE_URL?.trim() || null
}

/** A full run on a developer's machine, which starts from an empty database. */
export function resetsDatabase(args, env) {
  return !args.some(a => !a.startsWith('-')) && env.CI !== 'true'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const beDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const refuse = message => {
    console.error(`check: ${message}`)
    process.exit(2)
  }
  const args = process.argv.slice(2)
  let argv
  try {
    argv = nodeArgs(args)
  } catch (err) {
    refuse(err.message)
  }

  const nodeProblem = nodeRefusal(process.version, readFileSync(join(beDir, '..', '.nvmrc'), 'utf8'))
  if (nodeProblem) refuse(nodeProblem)

  const envFile = join(beDir, '.env')
  const dotenvText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  const url = testDatabaseUrl(process.env, dotenvText)
  if (!url) {
    refuse('no TEST_DATABASE_URL, so the integration tests would skip and prove nothing: run `npm run test:db` once')
  }

  if (resetsDatabase(args, process.env)) {
    const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
    const resetProblem = resetRefusal(database, parse(dotenvText))
    if (resetProblem) refuse(`a full run starts from an empty database, and ${resetProblem}`)
    await prepareTestDatabase(url, { reset: true })
    console.log(`check: a full run, so ${database} starts empty, as CI's does`)
  }

  const result = spawnSync(process.execPath, argv, { cwd: beDir, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
