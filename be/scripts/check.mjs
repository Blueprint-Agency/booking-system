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
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const beDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  let args
  try {
    args = nodeArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`check: ${err.message}`)
    process.exit(2)
  }
  const result = spawnSync(process.execPath, args, { cwd: beDir, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
