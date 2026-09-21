import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { packArchive, unpackArchive } from '../services/tenants/transfer-archive'
import { validateConfig } from './config'
import { compareFigures, figuresOf, type Figures } from './figures'
import { mapStudio, renderPreflight, type MindbodyReports, type Transformed } from './mapper'
import {
  readAccountBalances,
  readAttendance,
  readMemberList,
  readPayroll,
  readPayRates,
  readPhoneBook,
  readPricingOptionRegister,
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
const REPORTS = {
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
  // History. One workbook per year, like the roster, because a studio's whole
  // past is far too much for one file.
  attendance: { label: 'Attendance — Date', test: (f: string) => /attendance.*date/i.test(f) },
  payroll: { label: 'Payroll — Detail', test: (f: string) => /payroll.*detail/i.test(f) },
} as const

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
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
}): Promise<TransformOutput> {
  if (!UUID.test(input.tenantId)) throw new Error(`"${input.tenantId}" is not a Tenant id`)
  const config = validateConfig(input.config)
  const reports = await readReports(input.reportsDir)
  const result = mapStudio(reports, config, input.tenantId.toLowerCase())
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
