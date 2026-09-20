import { readHtmlTable, type TableRow } from './html-table'
import {
  cleanEmail,
  cleanPhone,
  parseMindbodyDate,
  parseMoney,
  parseSessions,
  tidy,
  type LocalDateTime,
  type SessionCount,
} from './values'

/**
 * One reader per Mindbody report: a file's text in, typed rows out.
 *
 * Each finds its header row by the column names it needs — not by position,
 * because a report's column set changes with the options it was run with — and
 * then keeps only the rows that are data by that report's own test, which is
 * what drops the group headers, subtotals, blank separators and total lines.
 * A report whose header is missing is refused by name: reading it as empty would
 * import a studio with no members and say nothing.
 */

/** A client barcode: nine digits, or the rare imported legacy shape (two letters, six digits). */
const CLIENT_ID = /^(\d{9}|[A-Z]{2}\d{6})$/

type Columns = Record<string, number>

function header(rows: TableRow[], report: string, required: readonly string[]): { at: number; columns: Columns } {
  const at = rows.findIndex(row => required.every(name => row.cells.some(c => c.toLowerCase() === name.toLowerCase())))
  if (at < 0) {
    throw new Error(`${report}: no header row with the columns ${required.join(', ')} — is this the right report?`)
  }
  const columns: Columns = {}
  rows[at]!.cells.forEach((cell, i) => {
    const key = cell.toLowerCase()
    if (!(key in columns)) columns[key] = i
  })
  return { at, columns }
}

function cell(row: TableRow, columns: Columns, name: string): string {
  const i = columns[name.toLowerCase()]
  return i === undefined ? '' : (row.cells[i] ?? '')
}

/** The client id from its cell, or from a `/clients/<id>/` link where the cell has only a name. */
function clientId(row: TableRow, columns: Columns, name: string): string | null {
  const text = cell(row, columns, name)
  if (CLIENT_ID.test(text)) return text
  for (const link of row.links) {
    const id = link?.match(/\/clients\/([A-Z0-9]+)\//i)?.[1]
    if (id && CLIENT_ID.test(id)) return id
  }
  return null
}

function dataRows(rows: TableRow[], at: number) {
  return rows.slice(at + 1)
}

/* ── 02 Mailing Lists — Mailing List (or Email List): the client master ───── */

export type MemberListRow = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string
}

/** `.` and `,` are what a surname field holds when nobody typed one. */
function surname(raw: string): string {
  const name = tidy(raw)
  return /^[.,\s-]*$/.test(name) ? '' : name
}

export function readMemberList(html: string): MemberListRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Member list (Mailing Lists)', ['Last name', 'First name', 'ID', 'Email'])
  const out: MemberListRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'ID')
    if (!id) continue // the "Total clients: N" line
    out.push({
      id,
      firstName: tidy(cell(row, columns, 'First name')),
      lastName: surname(cell(row, columns, 'Last name')),
      email: cleanEmail(cell(row, columns, 'Email')),
      phone: cleanPhone(cell(row, columns, 'Mobile phone')),
    })
  }
  return out
}

/* ── 21 Referral Types (detail files): each client's profile creation date ─── */

export type ReferralRow = { id: string; createdAt: LocalDateTime }

export function readReferralTypes(html: string): ReferralRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Referral Types', ['Client', 'Barcode', 'Entry Date'])
  const out: ReferralRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'Barcode')
    // Entry Date is D/M/YYYY with a lower-case am/pm, or the date alone.
    const createdAt = parseMindbodyDate(cell(row, columns, 'Entry Date'), 'DM')
    if (!id || !createdAt) continue
    out.push({ id, createdAt })
  }
  return out
}

/* ── 24 Retention Management: gender, for members holding a membership ────── */

export type RetentionRow = {
  id: string
  gender: 'female' | 'male' | null
  /** Mindbody's numeric location id, as the report prints it. */
  location: string
  memberSince: LocalDateTime | null
  membershipExpiration: LocalDateTime | null
  lastVisit: LocalDateTime | null
}

export function readRetentionManagement(html: string): RetentionRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Retention Management', ['ID', 'Gender', 'Member Since'])
  const out: RetentionRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'ID')
    if (!id) continue
    const gender = cell(row, columns, 'Gender').toUpperCase()
    out.push({
      id,
      gender: gender === 'F' ? 'female' : gender === 'M' ? 'male' : null,
      location: cell(row, columns, 'Location'),
      memberSince: parseMindbodyDate(cell(row, columns, 'Member Since'), 'DM'),
      // The one M/D column in an otherwise D/M report.
      membershipExpiration: parseMindbodyDate(cell(row, columns, 'Membership Expiration'), 'MD'),
      lastVisit: parseMindbodyDate(cell(row, columns, 'Last'), 'DM'),
    })
  }
  return out
}

/* ── 35 Phone Book: the staff master ──────────────────────────────────────── */

export type PhoneBookRow = {
  /** `First Last`, spaces collapsed. There is no staff id in any report. */
  name: string
  phone: string
  email: string | null
  active: boolean
  teacher: boolean
  staff: boolean
}

export function readPhoneBook(html: string): PhoneBookRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Staff phone book', ['Name', 'Email', 'Active', 'Teacher'])
  const flag = (row: TableRow, name: string) => cell(row, columns, name).toLowerCase() === 'true'
  const out: PhoneBookRow[] = []
  for (const row of dataRows(rows, at)) {
    const name = tidy(cell(row, columns, 'Name'))
    if (!name) continue
    out.push({
      name,
      phone: cleanPhone(cell(row, columns, 'Mobile phone')),
      email: cleanEmail(cell(row, columns, 'Email')),
      active: flag(row, 'Active'),
      teacher: flag(row, 'Teacher'),
      staff: flag(row, 'Staff'),
    })
  }
  return out
}

/* ── 15 Visits Remaining — Detail: what every client holds, by pricing option ─ */

export type HoldingRow = {
  clientId: string
  serviceCategory: string
  /** The pricing option's name as written: case and spacing vary, and some contain ` | `. */
  option: string
  firstActivation: LocalDateTime | null
  lastExpiration: LocalDateTime | null
  /** What was paid for these holdings, in dollars. */
  totalPaid: number
  purchased: SessionCount | null
  remaining: SessionCount | null
  /** Remaining, less the future visits already booked against it. */
  unbooked: SessionCount | null
}

/**
 * Takes a workbook already read into rows (`./xlsx.ts`). One row per client,
 * service category and pricing option — a client's holdings of one option are
 * combined, so this is what they hold and not what they bought.
 */
export function readVisitsRemaining(rows: TableRow[]): HoldingRow[] {
  const { at, columns } = header(rows, 'Visits Remaining', ['Client ID', 'Pricing option', 'Visits Remaining', 'Unbooked'])
  const out: HoldingRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'Client ID')
    const option = tidy(cell(row, columns, 'Pricing option'))
    if (!id || !option) continue
    out.push({
      clientId: id,
      serviceCategory: tidy(cell(row, columns, 'Service Category')),
      option,
      firstActivation: parseMindbodyDate(cell(row, columns, 'First Activation Date'), 'DM'),
      lastExpiration: parseMindbodyDate(cell(row, columns, 'Last Expiration Date'), 'DM'),
      totalPaid: parseMoney(cell(row, columns, 'Total Amount')) ?? 0,
      purchased: parseSessions(cell(row, columns, 'Purchased')),
      remaining: parseSessions(cell(row, columns, 'Visits Remaining')),
      unbooked: parseSessions(cell(row, columns, 'Unbooked')),
    })
  }
  return out
}

/* ── 13 Pricing Option Expirations: every option sold, one row per purchase ── */

export type OptionSaleRow = {
  /** `Surname, First`. The report carries no client id, not even in a link. */
  client: string
  option: string
  activation: LocalDateTime
  expiration: LocalDateTime
  paid: number
}

export function readPricingOptionRegister(html: string): OptionSaleRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Pricing Option Expirations', [
    'Client',
    'Pricing Options/Memberships',
    'Activation Date',
    'Expiration Date',
  ])
  const out: OptionSaleRow[] = []
  for (const row of dataRows(rows, at)) {
    const activation = parseMindbodyDate(cell(row, columns, 'Activation Date'), 'DM')
    const expiration = parseMindbodyDate(cell(row, columns, 'Expiration Date'), 'DM')
    const option = tidy(cell(row, columns, 'Pricing Options/Memberships'))
    if (!activation || !expiration || !option) continue
    out.push({
      client: tidy(cell(row, columns, 'Client')),
      option,
      activation,
      expiration,
      paid: parseMoney(cell(row, columns, 'Paid')) ?? 0,
    })
  }
  return out
}

/* ── 19 Big Spenders — Detail (accrual): every sale line ──────────────────── */

export type SaleRow = {
  saleId: string
  soldAt: LocalDateTime
  description: string
  location: string
  /** -1 on a return. */
  quantity: number
  total: number
}

/**
 * Sale lines only. The report is client blocks — a header row repeated per
 * client (and again at each page break), a section row, the lines, subtotals
 * and a total — and a line is the one row whose first cell is a sale number and
 * whose second is a date. The one report whose dates are M/D.
 */
export function readSales(html: string): SaleRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Big Spenders (detail)', ['Sale Date', 'Description', 'Quantity', 'Sales Total'])
  const out: SaleRow[] = []
  for (const row of dataRows(rows, at)) {
    const saleId = row.cells[0] ?? ''
    const soldAt = parseMindbodyDate(cell(row, columns, 'Sale Date'), 'MD')
    if (!/^\d+$/.test(saleId) || !soldAt) continue
    out.push({
      saleId,
      soldAt,
      description: tidy(cell(row, columns, 'Description')),
      location: tidy(cell(row, columns, 'Location')),
      quantity: parseMoney(cell(row, columns, 'Quantity')) ?? 0,
      total: parseMoney(cell(row, columns, 'Sales Total')) ?? 0,
    })
  }
  return out
}

/* ── 04 Account Balances — All balances: money on account, either way ─────── */

export type AccountBalanceRow = {
  clientId: string
  /** Negative when the client owes the studio. */
  balance: number
}

export function readAccountBalances(html: string): AccountBalanceRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Account Balances', ['ID', 'Client', 'Account balance'])
  const out: AccountBalanceRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'ID')
    const balance = parseMoney(cell(row, columns, 'Account balance'))
    if (!id || balance === null) continue // the "Total:" line
    out.push({ clientId: id, balance })
  }
  return out
}
