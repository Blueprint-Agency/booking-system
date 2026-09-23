/**
 * Which backend test files a change reaches, so the Stop hook runs those
 * instead of the whole ~25-minute suite. CI still runs everything on the PR.
 *
 * A test is picked when:
 *  - it is itself one of the changed files, or
 *  - it imports a changed file, directly or through other modules, or
 *  - the import chain reaches a route file, and the test calls that route's
 *    URL (HTTP tests reach routes through `app.ts`, not through an import).
 *
 * The chain is not followed through the files every test reaches anyway
 * (`app.ts`, the harness, a routes `index.ts`) — through them, everything
 * reaches everything. A change that still reaches more than HUB_LIMIT tests
 * (the schema, `db/index.ts`, a shared helper) is a hub: it runs the tenant
 * isolation guards, and leaves the rest to CI.
 *
 * Paths in and out are relative to `be/`, with forward slashes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

export const HUB_LIMIT = 15
export const GUARDS = ['src/test/isolation.test.ts', 'src/test/rls.test.ts', 'src/test/rls-coverage.test.ts']
const ROOTS = ['src', 'tools']
const STOP = new Set(['src/app.ts', 'src/index.ts', 'src/test/harness.ts'])
const isTest = (p) => p.endsWith('.test.ts')
const isStop = (p) => STOP.has(p) || (p.startsWith('src/routes/') && p.endsWith('/index.ts'))

function listTs(beDir) {
  const out = []
  const walk = (rel) => {
    for (const name of readdirSync(join(beDir, rel))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const child = `${rel}/${name}`
      if (statSync(join(beDir, child)).isDirectory()) walk(child)
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(child)
    }
  }
  for (const root of ROOTS) if (existsSync(join(beDir, root))) walk(root)
  return out
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g

function resolve(files, from, spec) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec)).replace(/\.js$/, '')
  return [base, `${base}.ts`, `${base}/index.ts`].find((c) => files.has(c))
}

/** `.route('/path', ident)` mounts, walked down from `app.ts`: route file → its URL. */
function routeUrls(files, read) {
  const urls = new Map()
  const visit = (file, prefix) => {
    const src = read(file)
    const imports = new Map()
    for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(files, file, m[2])
      if (target) imports.set(m[1], target)
    }
    for (const m of src.matchAll(/\.route\(\s*['"]([^'"]*)['"]\s*,\s*(\w+)\s*\)/g)) {
      const target = imports.get(m[2])
      if (!target || urls.has(target)) continue
      const path = m[1] === '/' ? '' : m[1]
      // An index, or a file mounted at `/`, shares a URL every test of its
      // audience calls (`/api/v1/me`): too wide to pick tests by.
      const index = target.endsWith('/index.ts')
      urls.set(target, path && !index ? prefix + path : null)
      if (index) visit(target, prefix + path)
    }
  }
  if (files.has('src/app.ts')) visit('src/app.ts', '')
  return urls
}

export function backendTestFiles(beDir, changed) {
  const files = new Set(listTs(beDir))
  const cache = new Map()
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, readFileSync(join(beDir, f), 'utf8'))
    return cache.get(f)
  }

  const importers = new Map()
  for (const file of files) {
    for (const m of read(file).matchAll(SPECIFIER)) {
      const dep = resolve(files, file, m[1])
      if (!dep) continue
      if (!importers.has(dep)) importers.set(dep, new Set())
      importers.get(dep).add(file)
    }
  }
  const urls = routeUrls(files, read)
  const tests = [...files].filter(isTest)

  const picked = new Set()
  for (const start of changed.filter((p) => files.has(p))) {
    if (isTest(start)) {
      picked.add(start)
      continue
    }
    // Tests that import the change (nearest first) and tests that call a
    // route it reaches; the first are the closer evidence.
    const byImport = new Set()
    const byUrl = new Set()
    // Of those, the tests calling a route that is the change or imports it directly.
    const nearUrl = new Set()
    const near = new Set([start, ...(importers.get(start) ?? [])])
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) {
      const file = queue.shift()
      const url = urls.get(file)
      if (url) {
        for (const t of tests) {
          if (!read(t).includes(url)) continue
          byUrl.add(t)
          if (near.has(file)) nearUrl.add(t)
        }
      }
      if (file !== start && isStop(file)) continue
      for (const next of importers.get(file) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        if (isTest(next)) byImport.add(next)
        else queue.push(next)
      }
    }
    const all = new Set([...byImport, ...byUrl])
    const guards = GUARDS.filter((g) => files.has(g))
    const close = new Set([...byImport, ...nearUrl])
    const pick = all.size <= HUB_LIMIT ? all : close.size <= HUB_LIMIT ? [...close, ...guards] : guards
    for (const t of pick) picked.add(t)
  }
  return [...picked].sort()
}

// `node backend-tests.mjs <be dir> <changed path>...` prints the picks: for a human checking a guess.
if (process.argv[1]?.endsWith('backend-tests.mjs')) {
  const [beDir, ...changed] = process.argv.slice(2)
  if (beDir) console.log(backendTestFiles(beDir, changed).join('\n'))
}
