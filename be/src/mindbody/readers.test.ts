import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readHtmlTable, type TableRow } from './html-table'
import {
  readAccountBalances,
  readMemberList,
  readPhoneBook,
  readPricingOptionRegister,
  readReferralTypes,
  readRetentionManagement,
  readSales,
  readVisitsRemaining,
} from './readers'
import { parseMindbodyDate, cleanPhone, cleanEmail, normaliseOptionName, normaliseStaffName, parseSessions } from './values'
import { readXlsxTable } from './xlsx'

/**
 * The readers, on snippets shaped like the real exports.
 *
 * Mindbody's "Excel" download for these reports is an HTML table, written by
 * hand-rolled server templates: header cells wrapped in `<div><strong>`, a
 * total row at the bottom, group headers in the middle, cells padded with
 * whitespace and entities. Every snippet here is invented; the layout is not.
 */

test('a table is read cell by cell, entities decoded and whitespace collapsed', () => {
  const rows = readHtmlTable(`
    <table>
      <tr><td><div class="center-ch"><strong>Last name</strong></div></td><td><strong>First name</strong></td></tr>
      <tr class="resultRow"><td>  Tan&nbsp; </td><td>&#26519;&amp;Co  </td></tr>
    </table>`)
  assert.deepEqual(
    rows.map(r => r.cells),
    [
      ['Last name', 'First name'],
      ['Tan', '林&Co'],
    ],
  )
})

test('a row with no opening <tr> is still a row', () => {
  const rows = readHtmlTable(`
    <table>
      <tr><td>Client</td><td>Barcode</td></tr>
      <td>Doe, Jane</td><td>100000001</td></tr>
      <tr><td>Roe, Rick</td><td>100000002</td></tr>
    </table>`)
  assert.deepEqual(
    rows.map(r => r.cells),
    [
      ['Client', 'Barcode'],
      ['Doe, Jane', '100000001'],
      ['Roe, Rick', '100000002'],
    ],
  )
})

test('an id that is only in a link is kept beside the cell text', () => {
  const [row] = readHtmlTable(
    `<tr><td><a href="/app/clients/100000042/visits">Doe, Jane</a></td></tr>`,
  )
  assert.equal(row!.cells[0], 'Doe, Jane')
  assert.equal(row!.links[0], '/app/clients/100000042/visits')
})

test('dates are read in the order the column is written in, with or without a time', () => {
  // D/M with a lower-case am/pm; the day is past 12, so the order is not a guess.
  assert.deepEqual(parseMindbodyDate('24/4/2023 8:38:19 pm', 'DM'), {
    year: 2023, month: 4, day: 24, hour: 20, minute: 38, second: 19,
  })
  assert.deepEqual(parseMindbodyDate('29/5/2023', 'DM'), {
    year: 2023, month: 5, day: 29, hour: 0, minute: 0, second: 0,
  })
  // M/D, as the same report writes a different column.
  assert.deepEqual(parseMindbodyDate('11/26/2026', 'MD'), {
    year: 2026, month: 11, day: 26, hour: 0, minute: 0, second: 0,
  })
  assert.equal(parseMindbodyDate('12:00:00 AM', 'MD'), null)
  assert.equal(parseMindbodyDate('-', 'DM'), null)
  assert.equal(parseMindbodyDate('', 'DM'), null)
  // 12 am is midnight, 12 pm is noon.
  assert.equal(parseMindbodyDate('1/2/2024 12:05:00 am', 'DM')?.hour, 0)
  assert.equal(parseMindbodyDate('1/2/2024 12:05:00 PM', 'DM')?.hour, 12)
  // A date that cannot exist is refused rather than rolled into the next month.
  assert.equal(parseMindbodyDate('31/2/2024', 'DM'), null)
})

test('the placeholder phone is no phone, and emails are trimmed and lower-cased', () => {
  assert.equal(cleanPhone('10000000000'), '')
  assert.equal(cleanPhone(' 91234567 '), '91234567')
  assert.equal(cleanPhone('-'), '')
  assert.equal(cleanEmail('  Jane.Doe@Example.TEST '), 'jane.doe@example.test')
  assert.equal(cleanEmail('-'), null)
  assert.equal(cleanEmail(''), null)
  assert.equal(cleanEmail('not an address'), null)
})

test('one staff name reads the same whichever way round a report writes it', () => {
  const key = normaliseStaffName('Jane  Doe')
  assert.equal(normaliseStaffName('Doe, Jane'), key)
  assert.equal(normaliseStaffName('DOE, JANE '), key)
  assert.equal(normaliseStaffName('Jane Doe'), key)
  assert.notEqual(normaliseStaffName('Jane Roe'), key)
})

test('the member list: one member per row, the total row and the placeholders left behind', () => {
  const members = readMemberList(`
    <table>
      <tr align="left">
        <td><div><strong>Last name</strong></div></td><td><div><strong>First name</strong></div></td>
        <td><div><strong>Nickname</strong></div></td><td><div><strong>ID</strong></div></td>
        <td><div><strong>Mobile phone</strong></div></td><td><div><strong>Home phone</strong></div></td>
        <td><div><strong>Email</strong></div></td>
      </tr>
      <tr class="resultRow"><td>Doe </td><td>Jane</td><td></td><td style="mso-number-format:\\@">100000001</td>
        <td>91234567</td><td>10000000000</td><td> Jane@Example.test </td></tr>
      <tr class="resultRow"><td>.</td><td>Solo</td><td></td><td>AB123456</td>
        <td>10000000000</td><td>10000000000</td><td>-</td></tr>
      <tr><td colspan="20">Total clients: 2</td></tr>
    </table>`)
  assert.deepEqual(members, [
    { id: '100000001', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', phone: '91234567' },
    { id: 'AB123456', firstName: 'Solo', lastName: '', email: null, phone: '' },
  ])
})

test('referral types: the creation date per member, across group, subtotal and blank rows', () => {
  const rows = readReferralTypes(`
    <table>
      <tr><td>Client</td><td>Barcode</td><td>Entry Date</td></tr>
      <tr><td>Early, Ellie</td><td>100000009</td><td>13/5/2023 6:29:20 pm</td></tr>
      <tr><td colspan="5">CLASSPASS</td></tr>
      <tr><td>Doe, Jane</td><td>100000001</td><td>24/4/2023 8:38:19 am</td></tr>
      <td>Roe, Rick</td><td>100000002</td><td>29/5/2023</td></tr>
      <tr><td colspan="2">Total# of Clients Referred By CLASSPASS:</td><td>2</td></tr>
      <tr><td colspan="5">&nbsp;</td></tr>
      <tr><td>Total# of Clients Referred:</td><td>3</td></tr>
    </table>`)
  assert.deepEqual(
    rows.map(r => [r.id, r.createdAt.year, r.createdAt.month, r.createdAt.day, r.createdAt.hour]),
    [
      ['100000009', 2023, 5, 13, 18],
      ['100000001', 2023, 4, 24, 8],
      ['100000002', 2023, 5, 29, 0],
    ],
  )
})

test('retention management: gender, and the one column whose dates run M/D', () => {
  const rows = readRetentionManagement(`
    <table>
      <tr><td>Location</td><td>ID</td><td>Last name</td><td>First name</td><td>Birthday</td><td>Gender</td>
        <td>Member Since</td><td>Email</td><td>Status</td><td>Membership Type</td>
        <td>Membership Expiration</td><td>Last</td></tr>
      <tr><td>1</td><td>100000001</td><td>Doe</td><td>Jane</td><td>1/1/1900</td><td> F </td>
        <td>25/7/2024</td><td>jane@example.test</td><td>Active</td><td>Unlimited 3</td>
        <td>11/26/2026</td><td>16/9/2026</td></tr>
      <tr><td>2</td><td>100000002</td><td>Roe</td><td>Rick</td><td>-</td><td> M </td>
        <td>5/12/2024</td><td>rick@example.test</td><td>Active</td><td>PT - Bundle of 10</td>
        <td>12/7/2026</td><td>-</td></tr>
      <tr><td>0</td><td>100000003</td><td>Poe</td><td>Pat</td><td>-</td><td>-</td>
        <td>5/12/2024</td><td>pat@example.test</td><td>Inactive</td><td>Unlimited 3</td>
        <td>1/7/2026</td><td>2/7/2026</td></tr>
    </table>`)
  assert.deepEqual(
    rows.map(r => ({ id: r.id, gender: r.gender, location: r.location, last: r.lastVisit?.day ?? null })),
    [
      { id: '100000001', gender: 'female', location: '1', last: 16 },
      { id: '100000002', gender: 'male', location: '2', last: null },
      { id: '100000003', gender: null, location: '0', last: 2 },
    ],
  )
  assert.equal(rows[0]!.membershipExpiration?.month, 11, 'expiration reads M/D')
  assert.equal(rows[0]!.memberSince?.month, 7, 'member since reads D/M')
})

test('the phone book: First Last names, a US mask on a local number, and the three flags', () => {
  const staff = readPhoneBook(`
    <table>
      <tr><td><strong>Name</strong></td><td><strong>Home phone</strong></td><td><strong>Work phone</strong></td>
        <td><strong>Ext.</strong></td><td><strong>Mobile phone</strong></td><td><strong>Email</strong></td>
        <td class="center-ch"><strong>Active</strong></td><td class="center-ch"><strong>Teacher</strong></td>
        <td class="center-ch"><strong>Staff</strong></td></tr>
      <tr><td>Jane  Doe
        </a></td><td></td><td></td><td></td><td>(912) 345-6789</td><td>
        Jane@Example.test </td><td>True</td><td>True</td><td>True</td></tr>
      <tr><td>Old Teacher</td><td></td><td></td><td></td><td></td><td></td>
        <td>False</td><td>True</td><td>False</td></tr>
    </table>`)
  assert.deepEqual(staff, [
    { name: 'Jane Doe', phone: '9123456789', email: 'jane@example.test', active: true, teacher: true, staff: true },
    { name: 'Old Teacher', phone: '', email: null, active: false, teacher: true, staff: false },
  ])
})

test('a report whose header cannot be found is refused by name, not read as empty', () => {
  assert.throws(() => readPhoneBook('<table><tr><td>Something else</td></tr></table>'), /phone book.*Name/i)
})

/* ── Packages (#178) ──────────────────────────────────────────────────────── */

const FIXTURES = path.join(__dirname, 'fixtures')

test('a workbook is read by cell reference, so an empty cell does not shift the ones after it', async () => {
  const written = JSON.parse(readFileSync(path.join(FIXTURES, 'visits-remaining.rows.json'), 'utf8')) as (string | number)[][]
  const read = await readXlsxTable(
    readFileSync(path.join(FIXTURES, 'reports', 'Clients', '15 Visits Remaining', '15 Visits Remaining - Detail.xlsx')),
  )
  // The workbook is built from these rows (`fixtures/build-workbook.ts`); text is
  // tidied on the way in, and the trailing blank cells of a row are simply absent.
  const tidy = (row: (string | number)[]) => {
    const cells = row.map(v => String(v).replace(/\s+/g, ' ').trim())
    while (cells.at(-1) === '') cells.pop()
    return cells
  }
  assert.deepEqual(read.map(r => tidy(r.cells)), written.map(tidy))
})

test('a workbook writes a control character as _x0008_, and it is dropped', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('xl/sharedStrings.xml', '<sst><si><t>_x0008_Main Hall studio access</t></si><si><r><t>Rich </t></r><r><t>text</t></r></si></sst>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row></sheetData></worksheet>')
  const rows = await readXlsxTable(await zip.generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(rows[0]!.cells, ['Main Hall studio access', '', 'Rich text'])
})

test('a session count of 9,999, 99,999 or 999,999 — less the visits used, or doubled — is unlimited', () => {
  for (const sentinel of ['9999', '99999', '999999', '999866', '199998']) {
    assert.deepEqual(parseSessions(sentinel), { unlimited: true }, sentinel)
  }
  assert.deepEqual(parseSessions('172'), { unlimited: false, count: 172 })
  assert.deepEqual(parseSessions('0'), { unlimited: false, count: 0 })
  assert.equal(parseSessions(''), null)
})

test('one pricing option reads the same in either case, with doubled spaces, or behind a control character', () => {
  const key = normaliseOptionName('2 Trial Classes for New Joiners')
  assert.equal(normaliseOptionName('2 Trial  Classes For New Joiners '), key)
  assert.equal(normaliseOptionName('\b2 Trial Classes for New Joiners'), key)
})

const table = (...rows: (string | number)[][]): TableRow[] =>
  rows.map(cells => ({ cells: cells.map(String), links: cells.map(() => null) }))

test('visits remaining: what a client holds, the unbooked balance, and the unlimited sentinel', () => {
  const holdings = readVisitsRemaining(
    table(
      ['Client ID', 'Client Name', 'Service Category', 'Pricing option', 'First Activation Date', 'Last Expiration Date', 'Total Amount', 'Visits Remaining', 'Purchased', 'Unbooked'],
      ['100000001', 'Doe, Jane', 'Class Bundles', 'Class Pack -  Bundle of 10', '1/8/2026', '13/10/2026', '998.462', '6', '10', '5'],
      ['AB123456', ', Legacy', 'Main Hall', 'Course | 2026', '5/6/2026', '5/12/2026', '3600', '99999', '99999', '99999'],
    ),
  )
  assert.deepEqual(holdings[0], {
    clientId: '100000001',
    serviceCategory: 'Class Bundles',
    option: 'Class Pack - Bundle of 10',
    firstActivation: { year: 2026, month: 8, day: 1, hour: 0, minute: 0, second: 0 },
    // D/M: the 13th of October, which no M/D reading could be.
    lastExpiration: { year: 2026, month: 10, day: 13, hour: 0, minute: 0, second: 0 },
    totalPaid: 998.462,
    purchased: { unlimited: false, count: 10 },
    remaining: { unlimited: false, count: 6 },
    unbooked: { unlimited: false, count: 5 },
  })
  assert.equal(holdings[1]!.option, 'Course | 2026', 'a name with a pipe in it is one name')
  assert.deepEqual(holdings[1]!.remaining, { unlimited: true })
})

test('the pricing option register: one purchase per row, under two title rows, money with a symbol', async () => {
  const sold = readPricingOptionRegister(
    readFileSync(path.join(FIXTURES, 'reports', 'Clients', '13 Pricing Option Expirations', '13 Pricing Option Expirations.xls'), 'utf8'),
  )
  assert.equal(sold.length, 8)
  const plan = sold.find(s => s.option === 'Unlimited 12')!
  assert.equal(plan.paid, 1700)
  assert.deepEqual([plan.activation.day, plan.activation.month, plan.expiration.year], [1, 2, 2027])
  assert.equal(sold.find(s => s.client === '林, Mei')?.option, 'PT - Bundle of 10')
})

test('sales: only the sale lines of each client block, dated M/D, a return as minus one', () => {
  const sales = readSales(
    readFileSync(path.join(FIXTURES, 'reports', 'Clients', '19 Big Spenders', '19 Big Spenders - Detail Accrual.xls'), 'utf8'),
  )
  assert.equal(sales.length, 9, 'client headers, section rows, subtotals and totals are not sales')
  const first = sales[0]!
  assert.deepEqual([first.saleId, first.soldAt.month, first.soldAt.day], ['351', 4, 24], 'M/D: the 24th of April')
  assert.equal(first.description, '2 Trial Classes for New Joiners')
  assert.equal(first.location, 'Main Hall')
  const returned = sales.find(s => s.saleId === '5402')!
  assert.deepEqual([returned.quantity, returned.total], [-1, -250])
  assert.equal(sales.find(s => s.saleId === '7000')!.total, 1700)
})

test('account balances: one row per client, and not the total line', () => {
  const balances = readAccountBalances(
    readFileSync(path.join(FIXTURES, 'reports', 'Clients', '04 Account Balances', '04 Account Balances - All balances.xls'), 'utf8'),
  )
  assert.deepEqual(balances, [{ clientId: '100000005', balance: -10 }])
})
