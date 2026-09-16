#!/usr/bin/env node
/**
 * Fails when the three error catalogues disagree.
 *
 * The backend's `ERROR_CODES` (be/src/shared/error-codes.ts) is the list of
 * codes the API can answer with. fe-client and fe-portal share no dependencies
 * with it, so each keeps its own copy; this compares their key sets against the
 * backend's and prints what each frontend is missing or has extra.
 *
 * No dependencies and no TypeScript loader: each file is read as text, and the
 * keys are the `key:` at the start of each line inside `ERROR_CODES = { … }`.
 *
 *   node scripts/check-error-codes.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CATALOGUES = {
  be: 'be/src/shared/error-codes.ts',
  'fe-client': 'fe-client/src/lib/error-codes.ts',
  'fe-portal': 'fe-portal/src/lib/error-codes.ts',
}

/** The keys of the `ERROR_CODES` object in a catalogue module's source. */
export function readCatalogueKeys(source) {
  const body = source.match(/export const ERROR_CODES = \{([\s\S]*?)\n\}/)
  if (!body) throw new Error('no `export const ERROR_CODES = { … }` found')
  const keys = []
  for (const line of body[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    // `key: 'key',` exactly — anything else would otherwise drop a key unseen.
    const entry = trimmed.match(/^([a-z0-9_]+): (['"])([a-z0-9_]+)\2,$/)
    if (!entry || entry[1] !== entry[3]) throw new Error(`unreadable catalogue line: ${trimmed}`)
    keys.push(entry[1])
  }
  return keys
}

/**
 * Each frontend's difference from the backend, in `CATALOGUES` order. An app
 * that matches is left out, so no drift is an empty list.
 */
export function findDrift(keysByApp) {
  const be = new Set(keysByApp.be)
  const drift = []
  for (const [app, keys] of Object.entries(keysByApp)) {
    if (app === 'be') continue
    const own = new Set(keys)
    const missing = [...be].filter(k => !own.has(k)).sort()
    const extra = [...own].filter(k => !be.has(k)).sort()
    if (missing.length || extra.length) drift.push({ app, missing, extra })
  }
  return drift
}

export function formatDrift(drift) {
  const lines = []
  for (const { app, missing, extra } of drift) {
    if (missing.length) lines.push(`${app} is missing: ${missing.join(', ')}`)
    if (extra.length) lines.push(`${app} has extra: ${extra.join(', ')}`)
  }
  return lines.join('\n')
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const keysByApp = Object.fromEntries(
    Object.entries(CATALOGUES).map(([app, path]) => {
      try {
        return [app, readCatalogueKeys(readFileSync(join(root, path), 'utf8'))]
      } catch (err) {
        console.error(`${path}: ${err.message}`)
        process.exit(1)
      }
    }),
  )
  const drift = findDrift(keysByApp)
  if (drift.length) {
    console.error(formatDrift(drift))
    console.error(`\nThe error catalogues have drifted. ${CATALOGUES.be} is the list; copy it to both frontends.`)
    process.exit(1)
  }
  console.log(`Error catalogues match (${keysByApp.be.length} codes).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
