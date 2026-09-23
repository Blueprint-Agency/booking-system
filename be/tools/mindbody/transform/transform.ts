import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { packArchive, unpackArchive } from '../../../src/services/tenants/transfer-archive'
import { validateConfig } from './config'
import { constraintViolations } from './constraints'
import { compareFigures, figuresOf, type Figures } from './figures'
import { mapStudio, renderPreflight, type MindbodyReports, type Transformed } from './mapper'
import {
  readAccountBalances,
  readAttendance,
  readAutopayDetail,
  readMemberList,
  readCancellations,
  readGroupCancellations,
  readPayroll,
  readPayRates,
  readPhoneBook,
  readPricingOptionRegister,
  readPromotions,
  readReferralTypes,
  readRetentionManagement,
  readRoster,
  readSales,
  readStaffSchedule,
  readVisitsRemaining,
} from './readers'
import { readXlsxTable } from './xlsx'

/**
 * The transform's edges: a folder of report files in, a zip and its three
 * companions out. Everything between is the pure mapper.
 */

/**
 * Which file is which report, by the name Mindbody's report and view give it.
 * The download script names files `NN <Report> - <View>.xls`; a studio's name is
 * never part of it.
 */
export const REPORTS = {
  members: { label: 'Mailing Lists — Mailing List', test: (f: string) => /mailing list\.[a-z]+$/i.test(f) },
  referrals: { label: 'Referral Types (detail files)', test: (f: string) => /referral types/i.test(f) && !/summary/i.test(f) },
  retention: { label: 'Retention Management', test: (f: string) => /retention management/i.test(f) },
  phoneBook: { label: 'Phone Book', test: (f: string) => /phone book/i.test(f) },
  // The Summary view is the same rows with fewer columns; Detail has the activation date.
  holdings: { label: 'Visits Remaining — Detail', test: (f: string) => /visits remaining.*detail/i.test(f) },
  optionSales: { label: 'Pricing Option Expirations', test: (f: string) => /pricing option expirations/i.test(f) },
  // Accrual is every sale at its sale date; Cash is a subset of it.
  sales: { label: 'Big Spenders — Detail Accrual', test: (f: string) => /big spenders.*detail accrual/i.test(f) },
  balances: { label: 'Account Balances — All balances', test: (f: string) => /account balances.*all balances/i.test(f) },
  // Every teacher in one file. The per-teacher files repeat it, and "Regular Schedule" is a template nobody fills in.
  schedule: { label: 'Staff Schedule — ALL, Scheduled', test: (f: string) => /staff schedule - all - scheduled\./i.test(f) },
  // One workbook per year, because it is large.
  roster: { label: 'Schedule at a Glance', test: (f: string) => /schedule at a glance/i.test(f) },
  payRates: { label: 'Pay Rates', test: (f: string) => /pay rates/i.test(f) },
  // History: Attendance without Revenue, Date view — one file, or one per year.
  // Only the Date view: Client, Staff member and Visit type are the same visits
  // sorted another way, "No-shows-late cancels" is a copy of Date, and read
  // beside it every visit would arrive twice. Attendance *Analysis* is totals.
  attendance: {
    label: 'Attendance without Revenue — Date',
    test: (f: string) => /attendance/i.test(f) && !/analysis/i.test(f) && /-\s*date\b/i.test(f),
  },
  payroll: { label: 'Payroll — Detail', test: (f: string) => /payroll.*detail/i.test(f) },
  // When each late cancel happened, and who did it.
  cancellations: { label: 'Cancellations — Individual records', test: (f: string) => /cancellations - individual records/i.test(f) },
  // The classes the studio called off. Its lines repeat Individual records, so
  // it is read for the classes, never for the members' cancels.
  groupCancellations: { label: 'Cancellations — Group cancellations', test: (f: string) => /cancellations - group cancellations/i.test(f) },
  // What a promotion took off each sale: the Summary view is totals per promotion.
  promotions: { label: 'Promotions — Detail', test: (f: string) => /promotions - detail/i.test(f) },
  // The autopays still to run: listed in the preflight, to stop in Mindbody.
  autopay: { label: 'Autopay Detail', test: (f: string) => /autopay detail/i.test(f) },
} as const

/**
 * Which reports a download must hold (`required`) and which are read as exactly one file
 * (`single`: two would be two downloads, with no saying which is current). `../report-files.json`
 * repeats these with the file names the cutover download writes; the downloader takes its names
 * and rules from that file (`../download/plan.ts`), and `transform.test.ts` holds the three together.
 */
export const REPORT_RULES: Record<keyof typeof REPORTS, { single: boolean; required: boolean }> = {
  members: { single: true, required: true },
  referrals: { single: false, required: true },
  retention: { single: true, required: true },
  phoneBook: { single: true, required: true },
  holdings: { single: true, required: true },
  optionSales: { single: true, required: true },
  sales: { single: true, required: true },
  balances: { single: true, required: false },
  schedule: { single: true, required: true },
  roster: { single: false, required: true },
  payRates: { single: true, required: false },
  attendance: { single: false, required: false },
  payroll: { single: false, required: false },
  cancellations: { single: false, required: false },
  groupCancellations: { single: true, required: false },
  promotions: { single: true, required: false },
  autopay: { single: true, required: false },
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter(e => e.isFile() && /\.(xlsx?|html?)$/i.test(e.name))
    .map(e => path.join(e.parentPath, e.name))
    .sort()
}

/** Read every report this transform uses out of a download folder. */
export async function readReports(dir: string): Promise<MindbodyReports> {
  const files = await filesUnder(dir)
  // Every problem with the folder at once, before any file is read.
  const problems: string[] = []
  for (const [kind, rule] of Object.entries(REPORT_RULES) as [keyof typeof REPORTS, { single: boolean; required: boolean }][]) {
    const found = files.filter(f => REPORTS[kind].test(path.basename(f)))
    if (rule.required && found.length === 0) problems.push(`${dir} has no ${REPORTS[kind].label} report`)
    if (rule.single && found.length > 1) problems.push(`${dir} has more than one ${REPORTS[kind].label} report: ${found.join(', ')}`)
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  const pick = (kind: keyof typeof REPORTS) => {
    const found = files.filter(f => REPORTS[kind].test(path.basename(f)))
    if (found.length === 0) throw new Error(`${dir} has no ${REPORTS[kind].label} report`)
    return found
  }
  const read = (file: string) => readFile(file, 'utf8')
  /** A report downloaded once. Two files of it would be two downloads, and there is no saying which is current. */
  const only = (kind: keyof typeof REPORTS, found: string[]) => {
    if (found.length > 1) throw new Error(`${dir} has more than one ${REPORTS[kind].label} report: ${found.join(', ')}`)
    return found[0]
  }
  const one = async (kind: keyof typeof REPORTS) => read(only(kind, pick(kind))!)
  /** A report a studio may simply not have downloaded. */
  const optional = (kind: keyof typeof REPORTS) => only(kind, files.filter(f => REPORTS[kind].test(path.basename(f))))

  const referrals = []
  for (const file of pick('referrals')) referrals.push(...readReferralTypes(await read(file)))

  const workbook = async (file: string) => readXlsxTable(await readFile(file))
  // A workbook, where the others are HTML. Exactly one, like them.
  const holdingsFile = only('holdings', pick('holdings'))!
  // Optional: a studio with no money on account may not have downloaded it.
  const balancesFile = optional('balances')
  // Optional: without it every imported class is Unpriced, which an admin can settle.
  const payRatesFile = optional('payRates')

  const roster = []
  for (const file of pick('roster')) roster.push(...readRoster(await workbook(file)))

  /** Every file of a report a studio may not have downloaded at all. */
  const optionalSet = (kind: keyof typeof REPORTS) => files.filter(f => REPORTS[kind].test(path.basename(f)))
  // Optional: only a studio importing history downloads them, and without them
  // its past arrives with no visits and every past class Unpriced.
  const attendance = []
  for (const file of optionalSet('attendance')) attendance.push(...readAttendance(await workbook(file)))
  const payroll = []
  for (const file of optionalSet('payroll')) payroll.push(...readPayroll(await read(file)))
  const cancellations = []
  for (const file of optionalSet('cancellations')) cancellations.push(...readCancellations(await read(file)))
  const groupCancellationsFile = optional('groupCancellations')
  // Optional: a download older than it has none, and every past sale is then read as sold at full price.
  const promotionsFile = optional('promotions')
  const autopayFile = optional('autopay')

  return {
    members: readMemberList(await one('members')),
    referrals,
    retention: readRetentionManagement(await one('retention')),
    phoneBook: readPhoneBook(await one('phoneBook')),
    holdings: readVisitsRemaining(await workbook(holdingsFile)),
    optionSales: readPricingOptionRegister(await one('optionSales')),
    sales: readSales(await one('sales')),
    balances: balancesFile ? readAccountBalances(await read(balancesFile)) : [],
    schedule: readStaffSchedule(await one('schedule')),
    roster,
    payRates: payRatesFile ? readPayRates(await workbook(payRatesFile)) : [],
    attendance,
    payroll,
    cancellations,
    groupCancellations: groupCancellationsFile ? readGroupCancellations(await read(groupCancellationsFile)) : [],
    promotions: promotionsFile ? readPromotions(await read(promotionsFile)) : [],
    // Optional: a download older than it lists no autopays, which is not the same as there being none.
    autopay: autopayFile ? readAutopayDetail(await read(autopayFile)) : [],
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A host that is the operator's own machine. */
const LOCAL_HOST = /(?:\/\/|\.)localhost(?=[:/,]|$)|\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b0\.0\.0\.0\b|\[::1\]/i

export type TransformOutput = Transformed & {
  /** The zip, byte-for-byte the same for the same inputs. */
  zip: Buffer
  /** The preflight report, for a person. */
  preflightText: string
  /** What the imported studio should add up to (`./figures.ts`). */
  expected: Figures
}

/**
 * Reports folder + studio config + the target Tenant's id → the archive.
 *
 * `tenantId` is the Tenant provisioned (with no first admin) to receive it. It
 * becomes `manifest.tenant.id`, which is what tells the importer to keep the
 * archive's ids as written.
 */
export async function transformMindbody(input: {
  reportsDir: string
  config: unknown
  tenantId: string
  /** The archive is for a database on this machine, so email links to it are meant. */
  local?: boolean
}): Promise<TransformOutput> {
  if (!UUID.test(input.tenantId)) throw new Error(`"${input.tenantId}" is not a Tenant id`)
  const config = validateConfig(input.config)
  // The links in every email are baked in from originPatterns. Built from a local
  // config and imported anywhere else, each one would point at the operator's machine.
  if (!input.local && LOCAL_HOST.test(config.originPatterns)) {
    throw new Error(
      `originPatterns "${config.originPatterns}" points the studio's email links at this machine. ` +
        'Use the config for the environment the archive is going to, or say the target is local (--local).',
    )
  }
  const reports = await readReports(input.reportsDir)
  const result = mapStudio(reports, config, input.tenantId.toLowerCase())
  // Caught here, naming every rule, rather than as one refused row at the end of the import.
  const violations = constraintViolations(result.archive)
  if (violations.length > 0) {
    throw new Error(`the archive would break the database's rules, so no zip was written:\n${violations.map(v => `  - ${v}`).join('\n')}`)
  }
  const zip = await packArchive(result.archive, { date: new Date(config.asOf) })
  return { ...result, zip, preflightText: renderPreflight(result.preflight), expected: figuresOf(result.archive) }
}

/**
 * Whether an imported studio adds up to what the transform wrote.
 *
 * `exportedZip` is the studio exported from the super portal after the import —
 * the platform's own account of what it now holds. Returns every difference,
 * by member; none means nothing was lost on the way in.
 */
export async function verifyImport(expected: Figures, exportedZip: Buffer | Uint8Array): Promise<string[]> {
  return compareFigures(expected, figuresOf(await unpackArchive(exportedZip)))
}

/** `studio.zip` → `studio.ids.json`, `studio.preflight.md`, `studio.expected.json`, beside it. */
export function companionPaths(zipPath: string) {
  const base = zipPath.replace(/\.zip$/i, '')
  return { ids: `${base}.ids.json`, preflight: `${base}.preflight.md`, expected: `${base}.expected.json` }
}
