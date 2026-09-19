/**
 * The Mindbody transform, from a terminal.
 *
 *   npm run mindbody -- starter   --reports <dir> --out <config.json>
 *   npm run mindbody -- transform --reports <dir> --config <config.json> --tenant <uuid> --out <studio.zip>
 *
 * `starter` writes a studio config pre-filled from the reports, for a person to
 * complete. `transform` writes the archive the super portal imports, plus
 * `<name>.ids.json` (Mindbody key → platform id) and `<name>.preflight.md`
 * (members with no email, or a shared one) beside it.
 *
 * Needs no database and no backend environment: it reads files and writes
 * files. The reports, the config and everything written are private — they
 * name real people — and live outside the repository.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { ConfigError, starterConfig } from './config'
import { companionPaths, readReports, transformMindbody } from './transform'

const USAGE = `usage:
  mindbody starter   --reports <dir> --out <config.json>
  mindbody transform --reports <dir> --config <config.json> --tenant <uuid> --out <studio.zip>`

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      reports: { type: 'string' },
      config: { type: 'string' },
      tenant: { type: 'string' },
      out: { type: 'string' },
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
    const config = starterConfig(await readReports(required('reports')))
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

    const counts = result.archive.manifest.counts
    console.log(`Wrote ${out}: ${counts.clients} members, ${counts.staff_users} staff.`)
    console.log(
      `Preflight: ${result.preflight.noEmail.length} members with no email, ` +
        `${result.preflight.sharedEmails.length} shared emails — see ${companions.preflight}.`,
    )
    return
  }

  throw new Error(USAGE)
}

main().catch(err => {
  // A config problem is the operator's to fix, so it is the list and nothing else.
  console.error(err instanceof ConfigError ? err.message : err)
  process.exit(1)
})
