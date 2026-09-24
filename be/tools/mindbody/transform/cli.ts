/**
 * The Mindbody transform, from a terminal. Operator tooling, not the app.
 *
 *   npm run mindbody -- starter   --export <export folder> --out <config.json> [--as-of <when the download finished>]
 *   npm run mindbody -- fill      --export <export folder> --starter <config.json> --answers <answers.json> [--out-dir <dir>]
 *   npm run mindbody -- transform --export <export folder> --config <config.json> --tenant <uuid> [--name <name>] [--local]
 *   npm run mindbody -- verify    --expected <studio.expected.json> --export-zip <exported.zip>
 *
 * An export folder is what `npm run mindbody:download` writes: `<root>/<YYYY-MM-DD HHmm>/`
 * with the reports under `reports/` and the finish time in `_logs/as-of.txt`. A relative
 * `--export` is looked for under MB_EXPORT_ROOT (be/.env). `--reports <dir>` points at a
 * reports folder directly instead.
 *
 * `starter` writes a studio config pre-filled from the reports, for a person to
 * complete (`--as-of` defaults to the export's `_logs/as-of.txt`). `fill` completes one
 * by rule from the studio's private answers file (`./fill.ts`), writing
 * `config.<output>.json` for each output it names (into the export folder by default).
 * `transform` writes the archive the super portal imports — `<name>.zip`, by default
 * `<slug>.zip` in the export folder, or `--out <file.zip>` — plus `<name>.ids.json`
 * (Mindbody key → platform id), `<name>.preflight.md` (what a person has to settle:
 * emails, and what does not come across) and `<name>.expected.json` (what the studio
 * should add up to) beside it. `verify` compares those figures with the studio exported
 * from the super portal after the import, lists every difference by member, and fails on any.
 *
 * Needs no database and no backend environment: it reads files and writes
 * files. The reports, the configs, the answers and everything written are
 * private — they name real people — and live outside the repository.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { config as loadEnv } from 'dotenv'
import { ConfigError, starterConfig } from './config'
import { reportFacts, staffFacts } from './facts'
import type { Figures } from './figures'
import { fillConfigs, type StudioAnswers } from './fill'
import { companionPaths, readReports, transformMindbody, verifyImport } from './transform'
import { isoDay, localDateOf } from './values'

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env') })

const USAGE = `usage:
  mindbody starter   --export <folder> --out <config.json> [--as-of <2026-01-31T02:00:00+08:00>]
  mindbody fill      --export <folder> --starter <config.json> --answers <answers.json> [--out-dir <dir>]
  mindbody transform --export <folder> --config <config.json> --tenant <uuid> [--name <name> | --out <studio.zip>] [--local]
    (--local: the archive is for a database on this machine, so localhost email links are meant)
  mindbody verify    --expected <studio.expected.json> --export-zip <exported.zip>
  (--reports <dir> in place of --export reads a reports folder directly)`

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      export: { type: 'string' },
      reports: { type: 'string' },
      config: { type: 'string' },
      starter: { type: 'string' },
      answers: { type: 'string' },
      'out-dir': { type: 'string' },
      tenant: { type: 'string' },
      out: { type: 'string' },
      name: { type: 'string' },
      'as-of': { type: 'string' },
      expected: { type: 'string' },
      'export-zip': { type: 'string' },
      local: { type: 'boolean', default: false },
    },
  })
  const required = (name: Exclude<keyof typeof values, 'local'>) => {
    const value = values[name]
    if (!value) throw new Error(`--${name} is required\n${USAGE}`)
    return value
  }

  /** The export folder: as given, or under MB_EXPORT_ROOT when it is a bare folder name. */
  const exportFolder = (): string | null => {
    const given = values.export
    if (!given) return null
    const root = process.env.MB_EXPORT_ROOT
    const candidates = [path.resolve(given), ...(root && !path.isAbsolute(given) ? [path.resolve(root, given)] : [])]
    const found = candidates.find(c => existsSync(c))
    if (!found) throw new Error(`no export folder ${given}${root ? ` (looked under MB_EXPORT_ROOT too)` : ''}`)
    return found
  }
  const reportsDir = () => {
    const folder = exportFolder()
    if (folder) return path.join(folder, 'reports')
    if (values.reports) return values.reports
    throw new Error(`--export (or --reports) is required\n${USAGE}`)
  }
  /** When the download finished: the export's `_logs/as-of.txt`, if it wrote one. */
  const exportAsOf = async (): Promise<string | null> => {
    const folder = exportFolder()
    const file = folder && path.join(folder, '_logs', 'as-of.txt')
    return file && existsSync(file) ? (await readFile(file, 'utf8')).trim() : null
  }

  if (command === 'starter') {
    const out = required('out')
    // A starter config holds the secret its invitation tokens are keyed by, and
    // soon a person's answers; writing over one would lose both.
    if (existsSync(out)) throw new Error(`${out} already exists — not overwriting a studio config`)
    const asOf = values['as-of'] ?? (await exportAsOf())
    if (asOf && Number.isNaN(Date.parse(asOf))) throw new Error(`--as-of "${asOf}" is not a date and time`)
    const config = starterConfig(await readReports(reportsDir()), asOf)
    await writeFile(out, json(config))
    console.log(`Wrote ${out}. Fill in every null (by hand, or with fill), then run transform.`)
    return
  }

  if (command === 'fill') {
    const starter = JSON.parse(await readFile(required('starter'), 'utf8')) as Record<string, any>
    const answers = JSON.parse(await readFile(required('answers'), 'utf8')) as StudioAnswers
    // The download's own finish time wins over the one a reused starter carries from an older download.
    const asOfText = values['as-of'] ?? (await exportAsOf()) ?? (starter.asOf as string | null)
    if (!asOfText || Number.isNaN(Date.parse(asOfText))) throw new Error('fill needs the as-of moment: the export has no _logs/as-of.txt and the starter no asOf, so pass --as-of')
    starter.asOf = asOfText
    // The studio's own calendar day at the as-of moment.
    const asOf = localDateOf(new Date(asOfText), answers.studio.timezone)
    const reports = await readReports(reportsDir())
    const pt = answers.ptPattern === undefined ? undefined : new RegExp(answers.ptPattern, 'i')
    const facts = reportFacts(reports, asOf, { offSiteVenues: answers.offSiteVenues, pt })
    const staff = staffFacts(reports, asOf, { pt })
    const outDir = values['out-dir'] ?? exportFolder() ?? path.dirname(required('starter'))
    await writeFile(path.join(outDir, 'report-facts.json'), json(facts))
    await writeFile(path.join(outDir, 'staff-facts.json'), json(staff))
    for (const [name, config] of Object.entries(fillConfigs(starter, answers, facts, staff))) {
      const file = path.join(outDir, `config.${name}.json`)
      await writeFile(file, json(config))
      const catalogue = config.catalogue as { migrate: string }[]
      console.log(
        `Wrote ${file}: slug ${config.studio.slug}, ${catalogue.filter(e => e.migrate === 'sell').length} on sale, ` +
          `${catalogue.filter(e => e.migrate === 'legacy').length} legacy, ${config.classTypes.length} class types, ` +
          `${config.series.filter((s: { migrate: boolean }) => s.migrate).length} series on.`,
      )
    }
    const w = facts.classWindow
    console.log(
      w
        ? `Class cancellation window: ${w.hours}h, from ${w.early} early and ${w.late} late cancels members made themselves` +
            `${w.misfits ? ` (${w.misfits} on the wrong side of it)` : ''}.`
        : 'Class cancellation window: the Cancellations report shows no cut-off, so the config keeps its own.',
    )
    console.log(`Facts as of ${isoDay(asOf)} in ${path.join(outDir, 'report-facts.json')} and staff-facts.json.`)
    return
  }

  if (command === 'transform') {
    const config = JSON.parse(await readFile(required('config'), 'utf8')) as { studio?: { slug?: string } }
    const folder = exportFolder()
    const out = values.out ?? (folder ? path.join(folder, `${values.name ?? config.studio?.slug ?? 'studio'}.zip`) : null)
    if (!out) throw new Error(`--out is required with --reports\n${USAGE}`)
    const result = await transformMindbody({ reportsDir: reportsDir(), config, tenantId: required('tenant'), local: values.local })
    const companions = companionPaths(out)
    await writeFile(out, result.zip)
    await writeFile(companions.ids, json(result.ids))
    await writeFile(companions.preflight, result.preflightText)
    await writeFile(companions.expected, json(result.expected))

    const counts = result.archive.manifest.counts
    console.log(
      `Wrote ${out}: ${counts.clients} members, ${counts.staff_users} staff, ` +
        `${counts.class_packages! + counts.pt_packages!} catalogue entries, ${counts.client_packages} packages held.`,
    )
    console.log(
      `Timetable: ${counts.classes} classes, ${counts.pt_sessions} PT sessions, ` +
        `${counts.workshops} workshops over ${counts.workshop_days} days, ${counts.bookings} bookings.`,
    )
    // History, where the config asked for it: the figures the studio will check.
    if (counts.check_ins || counts.cancellations) {
      const years = Object.entries(result.expected.byYear).sort(([a], [b]) => a.localeCompare(b))
      console.log(`History: ${counts.check_ins} check-ins, ${counts.cancellations} late cancels.`)
      for (const [year, y] of years) {
        console.log(`  ${year}: ${y.classes} classes, ${y.attended} attended, ${y.noShows} no-shows`)
      }
    }
    console.log(
      `Preflight: ${result.preflight.noEmail.length} members with no email, ` +
        `${result.preflight.sharedEmails.length} shared emails, ` +
        `${result.preflight.notMigrated.length} live items not migrated — see ${companions.preflight}.`,
    )
    return
  }

  if (command === 'verify') {
    const expected = JSON.parse(await readFile(required('expected'), 'utf8')) as Figures
    const differences = await verifyImport(expected, await readFile(required('export-zip')))
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
