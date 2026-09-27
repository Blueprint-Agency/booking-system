import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWaitlists, type ScheduledClassRow } from '../transform/readers'
import { readXlsxTable } from '../transform/xlsx'
import { describePlan, exportDir, plannedFiles, profileReports, readManifest, runDates } from './plan'
import { futureClasses, matchSignInLinks, mightHaveWaitlist, readWaitlistSection, splitCourses, waitlistSheet, type FutureClass } from './waitlists'
import { writeXlsx } from './xlsx-write'

/**
 * The Class Waitlists scrape (#311): which classes it opens, which link is each
 * class's sign-in screen, and what it reads off that screen's Waitlist section.
 * The browser half is `./engine.ts`; everything it decides is here.
 */

const TZ = 'Asia/Singapore'
const row = (over: Partial<ScheduledClassRow>): ScheduledClassRow => ({
  staff: 'IVY INSTRUCTOR',
  date: { year: 2090, month: 1, day: 2 },
  start: { hour: 19, minute: 0 },
  end: { hour: 20, minute: 0 },
  description: 'Hatha',
  substitute: false,
  location: 'Main Hall',
  serviceCategory: 'Classes',
  room: 'Hot Room',
  ...over,
})
const cells = (...rows: (string | [string, string])[][]) =>
  rows.map(r => ({ cells: r.map(c => (Array.isArray(c) ? c[0] : c)), links: r.map(c => (Array.isArray(c) ? c[1] : null)) }))

test('the cutover plan downloads the waitlists after the Staff Schedule, as the one file the transform reads', () => {
  const reports = profileReports('cutover', readManifest())
  const names = reports.map(r => r.kind)
  assert.ok(names.indexOf('waitlists') > names.indexOf('schedule'), 'the scrape reads the schedule this download wrote')
  const [file] = plannedFiles(reports.filter(r => r.kind === 'waitlists'))
  assert.equal(`${file!.folder}/${file!.file}`, 'Clients/45 Class Waitlists/45 Class Waitlists.xlsx')
  assert.equal(file!.type, 'scrape')
  const w = reports.find(r => r.kind === 'waitlists')!
  assert.equal(w.single, true)
  assert.ok(!w.optional, 'a failed scrape stops the cutover: every queue would be lost')

  const started = new Date(2026, 8, 17, 2, 5)
  const lines = describePlan('cutover', exportDir('exports', started), reports, runDates(started, new Date(2023, 0, 1)))
  const at = lines.findIndex(l => l.endsWith('reports/Clients/45 Class Waitlists/45 Class Waitlists.xlsx'))
  assert.ok(at >= 0, 'the dry run lists it')
  assert.ok(lines[at + 1]!.includes('transform reads it as waitlists, single file'))
})

test('every class still to come is opened once; a class already begun, or a second teacher on it, is not', () => {
  const now = new Date('2090-01-02T10:30:00Z') // 6:30pm in Singapore
  const classes = futureClasses(
    [
      row({ start: { hour: 18, minute: 0 } }), // started
      row({}),
      row({ description: 'HATHA ' }), // the same class, spelled again
      row({ date: { year: 2090, month: 1, day: 3 }, description: 'Vinyasa Flow', staff: 'OLIVE OWNER' }),
      row({ staff: 'OLIVE OWNER', description: 'Yin' }),
    ],
    now,
    TZ,
  )
  assert.deepEqual(
    classes.map(c => `${c.date.day} ${c.start.hour}:${c.start.minute} ${c.description} ${c.staff}`),
    ['2 19:0 Hatha IVY INSTRUCTOR', '2 19:0 Yin OLIVE OWNER', '3 19:0 Vinyasa Flow OLIVE OWNER'],
  )
})

test('a workshop or retreat session is a course, by the service categories the Courses page names, and every other row a class', () => {
  const retreat = row({ description: 'Kerala - India Yoga Retreat 2027', serviceCategory: 'Kerala, India Yoga Retreat 2027' })
  const workshop = row({ description: 'CHAIR & WHEEL YOGA WORKSHOP', serviceCategory: 'CHAIR &  WHEEL YOGA WORKSHOP ' })
  const hatha = row({})
  const { classes, courses } = splitCourses([hatha, retreat, workshop], ['CHAIR & WHEEL YOGA WORKSHOP', 'kerala, india yoga retreat 2027', 'Sapa Yoga Retreat 2027'])
  assert.deepEqual(courses, [retreat, workshop], 'matched on the category, however it is spaced or cased: the names differ between reports')
  assert.deepEqual(classes, [hatha])
  assert.deepEqual(splitCourses([hatha], []).classes, [hatha], 'with no courses, every row is a class to find')
})

test('a class\'s sign-in link is the one on its row, by start time and name, and by teacher where two share both', () => {
  const hatha: FutureClass = { date: { year: 2090, month: 1, day: 2 }, start: { hour: 19, minute: 0 }, description: 'Hatha', staff: 'IVY INSTRUCTOR' }
  const hathaOlive: FutureClass = { ...hatha, staff: 'OLIVE OWNER' }
  const yin: FutureClass = { ...hatha, start: { hour: 7, minute: 0 }, description: 'Yin' }
  const lost: FutureClass = { ...hatha, description: 'Mystery Class' }
  const { found, missing } = matchSignInLinks(
    [hatha, hathaOlive, yin, lost],
    [
      { href: '/ASP/adm/adm_help.asp', rowText: '7:00 pm Hatha Instructor, Ivy' },
      { href: '/ASP/adm/signin.asp?classID=11&classDate=1/2/2090', rowText: '7:00 pm - 8:00 pm HATHA Instructor, Ivy Hot Room' },
      { href: '/ASP/adm/signin.asp?classID=12&classDate=1/2/2090', rowText: '7:00pm - 8:00pm Hatha Owner, Olive Normal Room' },
      // Yin's row reads 7pm only at its end: the start is the first time a row shows.
      { href: '/ASP/adm/signin.asp?classid=13', rowText: '7:00 am - 7:00 pm Yin Instructor, Ivy' },
    ],
  )
  assert.deepEqual(
    found.map(f => `${f.cls.description} ${f.cls.staff} → ${f.href}`),
    [
      'Hatha IVY INSTRUCTOR → /ASP/adm/signin.asp?classID=11&classDate=1/2/2090',
      'Hatha OLIVE OWNER → /ASP/adm/signin.asp?classID=12&classDate=1/2/2090',
      'Yin IVY INSTRUCTOR → /ASP/adm/signin.asp?classid=13',
    ],
  )
  assert.deepEqual(missing, [lost], 'a class with no link is refused by the caller, never read as nobody waiting')
})

test('on Mindbody\'s class list, which shows the whole week, each class takes its own day\'s Sign In link', () => {
  const monday: FutureClass = { date: { year: 2090, month: 1, day: 2 }, start: { hour: 7, minute: 30 }, description: 'Warm Yoga', staff: 'MASTER VISHAL' }
  const tuesday: FutureClass = { ...monday, date: { year: 2090, month: 1, day: 3 } }
  const row = 'Sign In (2/35) Warm Yoga Master Vishal Tai Seng Taiseng Studio Edit class setup Cancel or delete class'
  const { found, missing } = matchSignInLinks(
    [monday, tuesday],
    [
      { href: '/ASP/adm/adm_cls_notes_e.asp?clsDate=1/2/2090&clsID=13436', rowText: `7:30 am - 8:30 am ${row}` },
      { href: '/ASP/adm/adm_cls_list.asp?pDate=1/2/2090&pClsID=13436', rowText: `7:30 am - 8:30 am ${row}` },
      // "Edit class setup", on the same row: it names the class too, and opens no sign-in screen.
      { href: '/ASP/adm/adm_cs_e.asp?classID=13436&clsDate=1/2/2090', rowText: `7:30 am - 8:30 am ${row}` },
      { href: '/ASP/adm/adm_cls_list.asp?pDate=1/3/2090&pClsID=13436', rowText: `7:30 am - 8:30 am ${row}` },
    ],
  )
  assert.deepEqual(
    found.map(f => `${f.cls.date.day} → ${f.href}`),
    ['2 → /ASP/adm/adm_cls_list.asp?pDate=1/2/2090&pClsID=13436', '3 → /ASP/adm/adm_cls_list.asp?pDate=1/3/2090&pClsID=13436'],
  )
  assert.deepEqual(missing, [])
})

test('only a class that could hold a line is opened: full, or starting within the margin; a row with no seat count is opened', () => {
  const now = new Date('2090-01-02T00:00:00Z') // 8am in Singapore
  const soon: FutureClass = { date: { year: 2090, month: 1, day: 2 }, start: { hour: 19, minute: 0 }, description: 'Hatha', staff: 'IVY INSTRUCTOR' }
  const later: FutureClass = { ...soon, date: { year: 2090, month: 1, day: 5 } }
  assert.equal(mightHaveWaitlist('7:00 pm Sign In (35/35) Hatha', later, now, TZ), true, 'full: people may be waiting')
  assert.equal(mightHaveWaitlist('7:00 pm Sign In (12/35) Hatha', later, now, TZ), false, 'seats free and days away: the line would have moved into them')
  assert.equal(mightHaveWaitlist('7:00 pm Sign In (12/35) Hatha', soon, now, TZ), true, 'inside the window a line can outlast a free seat')
  assert.equal(mightHaveWaitlist('7:00 pm Hatha', later, now, TZ), true, 'no seat count to go by: opened, never assumed empty')
})

test('a Waitlist section with no header row still names each client, from the cell holding their link', () => {
  // A row as Mindbody's sign-in screen draws its client lists: remove link, number, icon, client, phone, payment.
  const { waiting, unread } = readWaitlistSection(
    cells(
      [['', "javascript:cancWaitList(13436, '1/2/2090', 100000069)"], '1.', '', ['Puah, Cyndi', '/app/clients/100000069/client-info?rtnPage=clslist'], '91281338', 'Unlimited 18 + 6'],
      [['', "javascript:cancWaitList(13436, '1/2/2090', 100000070)"], '2.', '', ['Lee, Sam', '/app/clients/100000070/client-info'], '', ''],
    ),
  )
  assert.deepEqual(
    waiting.map(w => [w.position, w.clientId, w.client]),
    [[1, '100000069', 'Puah, Cyndi'], [2, '100000070', 'Lee, Sam']],
  )
  assert.equal(unread, 0)
})

test('the Waitlist section reads in queue order, with the id from the cell or the client link', () => {
  const { waiting, unread } = readWaitlistSection(
    cells(
      ['#', 'Client', 'Payment Status', ''],
      ['1.', ['Poe, Pat', '/app/clients/100000003/profile'], 'Unpaid', 'Remove'],
      ['2.', ['Lee, Sam', '/ASP/adm/adm_clt_profile.asp?ID=100000004'], 'Class Pack - Bundle of 10', ''],
      ['3.', 'A guest (no profile)', '', ''],
      [],
      ['4', '100000005', 'Paid', ''],
    ),
  )
  assert.deepEqual(waiting, [
    { clientId: '100000003', client: 'Poe, Pat', position: 1, paymentStatus: 'Unpaid' },
    { clientId: '100000004', client: 'Lee, Sam', position: 2, paymentStatus: 'Class Pack - Bundle of 10' },
    // No profile: kept with no id, so the transform names it instead of it vanishing here.
    { clientId: '', client: 'A guest (no profile)', position: 3, paymentStatus: '' },
    { clientId: '100000005', client: '100000005', position: 4, paymentStatus: 'Paid' },
  ])
  assert.equal(unread, 1, 'a row with no client id is counted, for the run to warn about')
  // No numbers on the screen: the order of the rows is the queue.
  assert.deepEqual(
    readWaitlistSection(cells(['Name'], [['Poe, Pat', '/app/clients/100000003/x']], [['Lee, Sam', '/app/clients/100000004/x']])).waiting.map(
      w => [w.clientId, w.position],
    ),
    [['100000003', 1], ['100000004', 2]],
  )
  assert.deepEqual(readWaitlistSection(cells(['Client', 'Status'])), { waiting: [], unread: 0 }, 'an empty section is an empty line')
})

test('the workbook it writes is what the transform reads: a row per waiting client, in order, classes with none left out', async () => {
  const hatha: FutureClass = { date: { year: 2090, month: 1, day: 2 }, start: { hour: 19, minute: 0 }, description: 'Hatha', staff: 'IVY INSTRUCTOR' }
  const rows = waitlistSheet([
    {
      cls: hatha,
      waiting: [
        { clientId: '100000004', client: 'Lee, Sam', position: 2, paymentStatus: '' },
        { clientId: '100000003', client: 'Poe, Pat', position: 1, paymentStatus: 'Unpaid' },
      ],
    },
  ])
  const back = readWaitlists(await readXlsxTable(await writeXlsx(rows, 'Class Waitlists')))
  assert.deepEqual(
    back.map(w => [w.date, w.start, w.description, w.staff, w.clientId, w.position]),
    [
      [hatha.date, hatha.start, 'Hatha', 'IVY INSTRUCTOR', '100000003', 1],
      [hatha.date, hatha.start, 'Hatha', 'IVY INSTRUCTOR', '100000004', 2],
    ],
  )
  // Nobody waiting anywhere is still a file, with its header: an empty studio, not a missing report.
  assert.deepEqual(readWaitlists(await readXlsxTable(await writeXlsx(waitlistSheet([]), 'Class Waitlists'))), [])
})
