import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CUTOVER, REPORTS, type FieldSet, type ProfileEntry, type Report, type RunnerType, type StepName } from './reports'

/**
 * The download, planned without a browser: where it writes, which dates it
 * asks for, and the name of every file. The browser half (`./engine.ts`) only
 * carries this out.
 */

/** `be/tools/mindbody/report-files.json`: the files the transform reads, shared by both tools. */
export const MANIFEST_PATH = path.join(__dirname, '..', 'report-files.json')

export type ManifestEntry = { kind: string; file: string; single: boolean; required: boolean }

export function readManifest(file = MANIFEST_PATH): ManifestEntry[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { files: ManifestEntry[] }).files
}

export type Profile = 'full' | 'cutover'

/** One report of a profile, with the manifest's rules where the transform reads it. */
export type PlannedReport = ProfileEntry & {
  /** The file name the transform expects (`report-files.json`), when it reads this report. */
  file?: string
  /** The transform reads exactly one file of it: splitting it, or a capped file, fails the run. */
  single?: boolean
}

/**
 * The profile's reports. For the cutover profile the file name and the single
 * rule come from the manifest, so the two cannot drift: an entry whose kind the
 * manifest does not list, or a manifest line no entry downloads, stops here.
 */
export function profileReports(profile: Profile, manifest: ManifestEntry[] = readManifest()): PlannedReport[] {
  if (profile === 'full') return REPORTS
  const byKind = new Map(manifest.map(m => [m.kind, m]))
  const kinds = CUTOVER.flatMap(r => (r.kind ? [r.kind] : []))
  const unknown = kinds.filter(k => !byKind.has(k))
  const missing = manifest.filter(m => !kinds.includes(m.kind)).map(m => m.kind)
  const twice = kinds.filter((k, i) => kinds.indexOf(k) !== i)
  if (unknown.length || missing.length || twice.length) {
    throw new Error(
      `the cutover profile and report-files.json disagree: ` +
        [unknown.length && `not in the manifest: ${unknown.join(', ')}`, missing.length && `not downloaded: ${missing.join(', ')}`,
          twice.length && `downloaded twice: ${twice.join(', ')}`].filter(Boolean).join('; '),
    )
  }
  return CUTOVER.map(r => {
    const m = r.kind ? byKind.get(r.kind) : undefined
    if (m) return { ...r, file: m.file, single: m.single }
    return r.unverified && process.env.MB_AUTOPAY_PATH ? { ...r, path: process.env.MB_AUTOPAY_PATH } : r
  })
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

export type DateToken = '$START' | '$TODAY' | '$FUTURE1Y' | '$FUTURE'

export type RunDates = { start: Date; today: Date; future1y: Date; future: Date }

/** The history cutoff: MB_START (YYYY-MM-DD), else 1 Jan 2023. */
export function startDate(env: NodeJS.ProcessEnv = process.env): Date {
  const raw = env.MB_START || '2023-01-01'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`MB_START="${raw}": expected YYYY-MM-DD`)
  return new Date(`${raw}T00:00:00`)
}

export function runDates(today: Date, start: Date): RunDates {
  return {
    start,
    today,
    future1y: new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()),
    future: new Date(today.getFullYear() + 5, today.getMonth(), today.getDate()),
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
/** Mindbody's date boxes: D/M/YYYY. */
export const dmy = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

export function tokenDates(d: RunDates): Record<DateToken, Date> {
  return { $START: d.start, $TODAY: d.today, $FUTURE1Y: d.future1y, $FUTURE: d.future }
}

export const isToken = (v: unknown): v is DateToken => v === '$START' || v === '$TODAY' || v === '$FUTURE1Y' || v === '$FUTURE'

/** Field values with every date token written as a date. */
export function resolveTokens(set: FieldSet, d: RunDates): FieldSet {
  const dates = tokenDates(d)
  return Object.fromEntries(Object.entries(set).map(([k, v]) => [k, isToken(v) ? dmy(dates[v]) : v]))
}

/* ── Where it writes ───────────────────────────────────────────────────── */

/** An export folder's name: when the download started, `YYYY-MM-DD HHmm`. */
export function exportStamp(d: Date): string {
  return `${ymd(d)} ${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

/** `<root>/<YYYY-MM-DD HHmm>`: one folder per download, never mixed with another. */
export function exportDir(root: string, started: Date): string {
  return path.join(root, exportStamp(started))
}

/** The reports of an export live in `<export>/reports/<Clients|Staff>/<NN Report>/`. */
export const reportsDir = (exportDir: string) => path.join(exportDir, 'reports')
export const logsDir = (exportDir: string) => path.join(exportDir, '_logs')

/* ── File names ────────────────────────────────────────────────────────── */

/** Windows-safe, single-spaced. */
export const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()

/** `NN Report name`: the folder of a report, and the start of each of its files. */
export const reportPrefix = (r: Pick<Report, 'num' | 'name'>) => `${pad2(r.num)} ${safe(r.name)}`

/** The extension each kind of page downloads as. Old pages send HTML tables as `.xls`. */
export function expectedExtension(type: RunnerType): '.xls' | '.xlsx' {
  return type === 'legacy' || type === 'react' ? '.xls' : '.xlsx'
}

/** A job's file, without the date piece or extension: `NN Report[ - loop option][ - variant]`. */
export function jobBase(r: Pick<Report, 'num' | 'name'>, labels: string[]): string {
  return safe([reportPrefix(r), ...labels.filter(Boolean)].join(' - '))
}

export const pieceSuffix = (split: StepName | undefined) => (split === undefined ? '' : split === 'year' ? ' - <year>' : ' - <piece>')

export type PlannedFile = {
  report: PlannedReport
  /** `<Clients|Staff>/<NN Report>`, under `reports/`. */
  folder: string
  /** The file name, with `<group>` (one per loop option), `<year>` or `<piece>` (one per date piece). */
  file: string
  type: RunnerType
  path: string
  set: FieldSet
}

/**
 * Every file a profile writes, as far as it is known before the browser opens:
 * a report looping over a select's options writes one file per option
 * (`<group>`), unless the profile keeps exactly one of them under a fixed label.
 */
export function plannedFiles(reports: PlannedReport[]): PlannedFile[] {
  const out: PlannedFile[] = []
  for (const r of reports) {
    const loopLabel = r.loop ? r.loop.label : r.loopSelect ? '<group>' : ''
    for (const { label = '', set: vset = {}, ...override } of r.variants ?? [{ label: '' }]) {
      const type = override.type ?? r.type
      // `<group>` is kept out of safe(), which would turn its brackets into dashes.
      const labels = [loopLabel === '<group>' ? '' : loopLabel, label]
      const base = loopLabel === '<group>' ? `${reportPrefix(r)} - <group>${label ? ` - ${safe(label)}` : ''}` : jobBase(r, labels)
      out.push({
        report: r,
        folder: `${r.cat}/${reportPrefix(r)}`,
        file: `${base}${pieceSuffix(r.split)}${expectedExtension(type)}`,
        type,
        path: override.path ?? r.path,
        set: { ...r.set, ...vset },
      })
    }
  }
  return out
}

/**
 * A name as the transform expects it (`report-files.json`) → the pattern the
 * files written for it must match. Either extension: Mindbody decides it.
 */
export function manifestPattern(file: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = esc(file.replace(/\.xlsx?$/i, ''))
    .replace(esc('<year>'), '\\d{4}')
    .replace(esc('<group>'), '.+')
    .replace(esc('<piece>'), '.+')
  return new RegExp(`^${body}\\.xlsx?$`, 'i')
}

/** The dry run's account of a plan: one entry per file (or set of pieces), with its dates and rules. */
export function describePlan(profile: Profile, exportFolder: string, reports: PlannedReport[], d: RunDates): string[] {
  const dates = tokenDates(d)
  const lines = [
    `Profile: ${profile}   (dry run: no browser, nothing downloaded)`,
    `Export:  ${exportFolder}`,
    `Reports: ${reportsDir(exportFolder)}`,
    `Dates:   $START ${dmy(d.start)}   $TODAY ${dmy(d.today)}   $FUTURE1Y ${dmy(d.future1y)}   $FUTURE ${dmy(d.future)}`,
    '',
  ]
  plannedFiles(reports).forEach((f, i) => {
    const r = f.report
    const loop = r.loop
      ? ` × the one "${r.loopSelect}" option matching ${r.loop.match}`
      : r.loopSelect ? ` × each "${r.loopSelect}" option${r.loopOnly ? ` whose value matches ${r.loopOnly}` : ''}` : ''
    const range = Object.entries(f.set).filter(([, v]) => isToken(v)).map(([k, v]) => `${k}=${dmy(dates[v as DateToken])}`).join(' ')
    const flags = [
      r.kind && `transform reads it as ${r.kind}`,
      r.single && 'single file (split/capped = FAIL)',
      r.optional && 'optional',
      r.unverified && 'UNVERIFIED path',
      r.split && `one file per ${r.split}`,
    ].filter(Boolean).join(', ')
    lines.push(`${String(i + 1).padStart(2)}. reports/${f.folder}/${f.file}`)
    lines.push(`    ${f.type} ${f.path}${loop}${range ? `\n    ${range}` : ''}${flags ? `\n    ${flags}` : ''}`)
  })
  return lines
}
