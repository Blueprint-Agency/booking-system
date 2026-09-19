import test from 'node:test'
import assert from 'node:assert/strict'
import { readHtmlTable } from './html-table'
import { readMemberList, readReferralTypes, readRetentionManagement, readPhoneBook } from './readers'
import { parseMindbodyDate, cleanPhone, cleanEmail, normaliseStaffName } from './values'

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
