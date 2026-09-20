import { readHtmlTable, type TableRow } from './html-table'
import {
  cleanEmail,
  cleanPhone,
  excelDate,
  excelTime,
  parseClock,
  parseMindbodyDate,
  parseMoney,
  parseSessions,
  tidy,
  type CalendarDate,
  type ClockTime,
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

/* ── 34 Staff Schedule — ALL, Scheduled: the timetable, empty classes and all ─ */

export type ScheduledClassRow = {
  /** The teacher, from the section heading: `FIRST LAST`, upper-case. */
  staff: string
  date: CalendarDate
  start: ClockTime
  end: ClockTime
  /** The class name with any trailing `***` removed. */
  description: string
  /** `***` after the name: a substitute is teaching, and `staff` is that substitute. */
  substitute: boolean
  location: string
  /** Mindbody's service category: the studio's programme, or a workshop's or a retreat's own. */
  serviceCategory: string
  room: string
}

const SECTION = /^SCHEDULE FOR\s+(.+)$/i
const DAY_HEADING = /^[A-Za-z]+,\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/
const TIME_RANGE = /^(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)$/i
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * The one report with no header row. It is nested tables: a `SCHEDULE FOR …`
 * heading per teacher, a bold day heading, then six cells per row — time,
 * name, location, service category, room, notes — so a heading can share a row
 * with whatever follows it and every cell is looked at for what it is.
 *
 * Three kinds of row carry a time, and one is a class:
 *  - a class, with its Location filled;
 *  - the italic "Unavailable - Teaching Class" block Mindbody writes beside
 *    every class, with everything after the name blank;
 *  - an appointment-availability window, with no Location either.
 * The `TOTAL # OF CLASSES` footer sits in a cell like a day heading's and is neither.
 */
export function readStaffSchedule(html: string): ScheduledClassRow[] {
  const out: ScheduledClassRow[] = []
  let staff: string | null = null
  let date: CalendarDate | null = null
  for (const row of readHtmlTable(html)) {
    for (const [i, text] of row.cells.entries()) {
      const section = SECTION.exec(text)
      if (section) {
        staff = tidy(section[1]!)
        date = null
        continue
      }
      const day = DAY_HEADING.exec(text)
      if (day) {
        const month = MONTHS.indexOf(day[2]!.toLowerCase()) + 1
        date = month > 0 ? { year: Number(day[3]), month, day: Number(day[1]) } : null
        continue
      }
      const range = TIME_RANGE.exec(text)
      if (!range || !staff || !date) continue
      const [start, end] = [parseClock(range[1]!), parseClock(range[2]!)]
      const name = tidy(row.cells[i + 1] ?? '')
      const location = tidy(row.cells[i + 2] ?? '')
      if (!start || !end || !name || !location || /^unavailable\b/i.test(name)) break
      out.push({
        staff,
        date,
        start,
        end,
        description: tidy(name.replace(/\*+\s*$/, '')),
        substitute: /\*+\s*$/.test(name),
        location,
        serviceCategory: tidy(row.cells[i + 3] ?? ''),
        room: tidy(row.cells[i + 4] ?? ''),
      })
      break
    }
  }
  return out
}

/* ── 17 Schedule at a Glance: the roster, one row per client per class ─────── */

export type RosterRow = {
  date: CalendarDate
  start: ClockTime
  end: ClockTime | null
  description: string
  /** `Last, First`. */
  staff: string
  room: string
  location: string
  clientId: string
  /** `Reserved`, `Signed in`, `Late Cancel`, … */
  status: string
}

/**
 * Takes a workbook already read into rows (`./xlsx.ts`). Dates and times are
 * real workbook values here — a day count and a fraction of a day — and are
 * read as such; a text date is accepted too, D/M like the rest of Mindbody.
 */
export function readRoster(rows: TableRow[]): RosterRow[] {
  const { at, columns } = header(rows, 'Schedule at a Glance', ['Date', 'Start time', 'Description', 'Staff', 'Client ID', 'Status'])
  const out: RosterRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'Client ID')
    const date = excelDate(cell(row, columns, 'Date')) ?? parseMindbodyDate(cell(row, columns, 'Date'), 'DM')
    const start = excelTime(cell(row, columns, 'Start time')) ?? parseClock(cell(row, columns, 'Start time'))
    if (!id || !date || !start) continue
    out.push({
      date: { year: date.year, month: date.month, day: date.day },
      start,
      end: excelTime(cell(row, columns, 'End time')) ?? parseClock(cell(row, columns, 'End time')),
      description: tidy(cell(row, columns, 'Description')),
      staff: tidy(cell(row, columns, 'Staff')),
      room: tidy(cell(row, columns, 'Room')),
      location: tidy(cell(row, columns, 'Location')),
      clientId: id,
      status: tidy(cell(row, columns, 'Status')),
    })
  }
  return out
}

/* ── 38 Pay Rates: what each teacher is paid for a class ──────────────────── */

export type PayRateRow = {
  /** `Last, First`. */
  staff: string
  /** Dollars per class, or null where the teacher has no per-class rate (paid per head, or not at all). */
  perClass: number | null
}

/**
 * Takes a workbook already read into rows. A block per teacher: a row naming
 * them and the rate slots, then a `Rate` row of amounts under those slots, then
 * bonus and tier rows nobody uses. The per-class rate is the first amount above
 * zero in a slot whose name says "Per Class".
 */
export function readPayRates(rows: TableRow[]): PayRateRow[] {
  const out: PayRateRow[] = []
  let block: { staff: string; slots: string[] } | null = null
  for (const row of rows) {
    const [first = '', second = '', ...rest] = row.cells
    if (first && !second && rest.some(c => /\brate\b/i.test(c)) && !/^default:/i.test(first)) {
      block = { staff: tidy(first), slots: rest }
      continue
    }
    if (block && /^rate$/i.test(second)) {
      const slots = block.slots
      const amounts = rest.map((c, i) => ({ slot: slots[i] ?? '', amount: parseMoney(c) ?? 0 }))
      const perClass = amounts.find(a => /per class/i.test(a.slot) && a.amount > 0)?.amount ?? null
      out.push({ staff: block.staff, perClass })
      block = null
    }
  }
  return out
}
