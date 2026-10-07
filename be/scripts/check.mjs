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
 *   SHARD=2/6 npm run check
 *
 * `SHARD=i/n` runs the i-th of n slices of the whole suite: the file list the
 * default patterns match, sorted, every n-th file from the i-th. CI runs the
 * suite as n such slices side by side, each on a database of its own, because
 * the harness holds one advisory lock per database for a whole run (see
 * docs/md/testing.md § Shards in CI). A slice runs serially, in one process,
 * exactly as the whole suite does; a bare `npm run check` is still the whole
 * suite in one run.
 *
 * It refuses to start where a green run would not predict CI's: on a Node
 * major other than `.nvmrc`'s, or with no `TEST_DATABASE_URL` (the integration
 * tests would skip). A full run — no test files named — starts from an empty
 * database, as CI's does: it drops and recreates the checkout's test database
 * first. CI's own database is new with every job, so there it is left alone.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
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

/** `SHARD=i/n` parsed, or null when unset. Refuses anything but `i/n` with 1 <= i <= n. */
export function parseShard(value) {
  if (!value?.trim()) return null
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value.trim())
  if (!m || Number(m[1]) > Number(m[2])) {
    throw new Error(`SHARD must be i/n with 1 <= i <= n (e.g. 2/6), not ${JSON.stringify(value)}`)
  }
  return { index: Number(m[1]), total: Number(m[2]) }
}

/** Every test file the default patterns match, relative to `beDir` with forward slashes, sorted. */
export function listTestFiles(beDir) {
  return globSync(DEFAULT_PATTERNS, { cwd: beDir })
    .map(f => f.replaceAll('\\', '/'))
    .sort()
}

/**
 * The files shard `index` of `total` runs: `files` sorted, every `total`-th
 * from the `index`-th. Deterministic, so the same checkout always slices the
 * same way, and checked: the shards together must be the whole list, no file in
 * two of them or in none, or a file could drop out of CI without a red run.
 */
export function shardFiles(files, { index, total }) {
  const sorted = [...files].sort()
  const shards = Array.from({ length: total }, (_, i) => sorted.filter((_, j) => j % total === i))
  const union = shards.flat().sort()
  if (union.length !== sorted.length || union.some((f, k) => f !== sorted[k])) {
    throw new Error(`shards 1..${total} do not cover the ${sorted.length} test files exactly once`)
  }
  return shards[index - 1]
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
    const shard = parseShard(process.env.SHARD)
    if (shard && args.some(a => !a.startsWith('-'))) {
      throw new Error('name test files or set SHARD, not both: a shard is a slice of the whole suite')
    }
    let files = []
    if (shard) {
      const all = listTestFiles(beDir)
      files = shardFiles(all, shard)
      console.log(`check: shard ${shard.index}/${shard.total}, ${files.length} of ${all.length} test files:\n  ${files.join('\n  ')}`)
    }
    argv = nodeArgs([...args, ...files])
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
