/**
 * The Mindbody transform, from a terminal.
 *
 *   npm run mindbody -- starter   --reports <dir> --out <config.json> [--as-of <when the download finished>]
 *   npm run mindbody -- transform --reports <dir> --config <config.json> --tenant <uuid> --out <studio.zip>
 *   npm run mindbody -- verify    --expected <studio.expected.json> --export <exported.zip>
 *
 * `starter` writes a studio config pre-filled from the reports, for a person to
 * complete. `transform` writes the archive the super portal imports, plus
 * `<name>.ids.json` (Mindbody key → platform id), `<name>.preflight.md` (what
 * a person has to settle: emails, and what does not come across) and
 * `<name>.expected.json` (what the studio should add up to) beside it. `verify`
 * compares those figures with the studio exported from the super portal after
 * the import, lists every difference by member, and fails on any.
 *
 * Needs no database and no backend environment: it reads files and writes
 * files. The reports, the config and everything written are private — they
 * name real people — and live outside the repository.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { ConfigError, starterConfig } from './config'
import type { Figures } from './figures'
import { companionPaths, readReports, transformMindbody, verifyImport } from './transform'

const USAGE = `usage:
  mindbody starter   --reports <dir> --out <config.json> [--as-of <2026-01-31T02:00:00+08:00>]
  mindbody transform --reports <dir> --config <config.json> --tenant <uuid> --out <studio.zip>
  mindbody verify    --expected <studio.expected.json> --export <exported.zip>`

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      reports: { type: 'string' },
      config: { type: 'string' },
      tenant: { type: 'string' },
      out: { type: 'string' },
      'as-of': { type: 'string' },
      expected: { type: 'string' },
      export: { type: 'string' },
    },
  })
  const required = (name: keyof typeof values) => {
    const value = values[name]
    if (!value) throw new Error(`--${name} is required\n${USAGE}`)
    return value
  }

  if (command === 'starter') {
    const out = required('out')
    // A starter config holds the secret its invitation tokens are keyed by, and
    // soon a person's answers; writing over one would lose both.
    if (existsSync(out)) throw new Error(`${out} already exists — not overwriting a studio config`)
    const asOf = values['as-of'] ?? null
    if (asOf && Number.isNaN(Date.parse(asOf))) throw new Error(`--as-of "${asOf}" is not a date and time`)
    const config = starterConfig(await readReports(required('reports')), asOf)
    await writeFile(out, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`Wrote ${out}. Fill in every null, then run transform.`)
    return
  }

  if (command === 'transform') {
    const out = required('out')
    const config = JSON.parse(await readFile(required('config'), 'utf8')) as unknown
    const result = await transformMindbody({ reportsDir: required('reports'), config, tenantId: required('tenant') })
    const companions = companionPaths(out)
    await writeFile(out, result.zip)
    await writeFile(companions.ids, `${JSON.stringify(result.ids, null, 2)}\n`)
    await writeFile(companions.preflight, result.preflightText)
    await writeFile(companions.expected, `${JSON.stringify(result.expected, null, 2)}\n`)

    const counts = result.archive.manifest.counts
    console.log(
      `Wrote ${out}: ${counts.clients} members, ${counts.staff_users} staff, ` +
        `${counts.class_packages! + counts.pt_packages!} catalogue entries, ${counts.client_packages} packages held.`,
    )
    console.log(
      `Preflight: ${result.preflight.noEmail.length} members with no email, ` +
        `${result.preflight.sharedEmails.length} shared emails, ` +
        `${result.preflight.notMigrated.length} live items not migrated — see ${companions.preflight}.`,
    )
    return
  }

  if (command === 'verify') {
    const expected = JSON.parse(await readFile(required('expected'), 'utf8')) as Figures
    const differences = await verifyImport(expected, await readFile(required('export')))
    if (differences.length === 0) {
      console.log('Verified: the imported studio adds up to what the transform wrote.')
      return
    }
    console.error(`${differences.length} difference(s):`)
    for (const d of differences) console.error(`  - ${d}`)
    process.exit(1)
  }

  throw new Error(USAGE)
}

main().catch(err => {
  // A config problem is the operator's to fix, so it is the list and nothing else.
  console.error(err instanceof ConfigError ? err.message : err)
  process.exit(1)
})
