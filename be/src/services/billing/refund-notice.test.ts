import assert from 'node:assert'
import {
  SILENT_AFTER_DAYS,
  abandonedLine,
  abandonedReturnLine,
  attendedNotice,
  cancelledClassesLine,
  composeAbandonedRefundEmail,
  composeRefundEmail,
  daysSilent,
  isSilent,
  isUntouched,
  silenceNotice,
  voidedLine,
} from './refund-notice'

// 2026-06-11T16:00Z is 12 Jun 2026 in Singapore — the offset is the whole point
// of reading these through the studio's clock rather than the server's.
const SINCE = new Date('2026-06-11T16:00:00Z')

// --- Untouched --------------------------------------------------------------
// A Dormant plan, and any plan whose only bookings are still ahead of it, is
// trivially Untouched: nothing was attended and nothing was no-showed.
{
  assert.strictEqual(isUntouched(0), true, 'no attendance and no no-show is Untouched')
  assert.strictEqual(attendedNotice(0, null), null, 'an Untouched purchase shows no notice')
  assert.strictEqual(attendedNotice(0, SINCE), null, 'a date cannot make an unused purchase touched')
}

// A no-show counts as used, so the fold that feeds this counts it — one touch is
// enough to lose Untouched, and the notice appears.
{
  assert.strictEqual(isUntouched(1), false, 'one attended or no-showed class ends Untouched')
  assert.strictEqual(
    attendedNotice(1, SINCE),
    '1 class attended since 12 Jun 2026',
    'the singular is spelled out, not pluralised by a rule',
  )
  assert.strictEqual(
    attendedNotice(3, SINCE),
    '3 classes attended since 12 Jun 2026',
    'the notice is the spec sentence verbatim',
  )
}

// The count is what makes it touched; the date is a nicety the fold may not
// have. A missing date must not print "since null" or an empty tail.
{
  assert.strictEqual(
    attendedNotice(2, null),
    '2 classes attended on this purchase',
    'no date still produces a whole sentence',
  )
}

// --- the money sentence -----------------------------------------------------
// Always the full amount — there is no partial refund, so no branch here can
// ever print a part of one.
{
  const s = voidedLine('Monthly Unlimited', '280.00')
  assert.ok(s.includes('S$280.00'), 'the amount refunded is named in full')
  assert.ok(s.includes('Monthly Unlimited'), 'the purchase is named')
  assert.ok(
    s.includes('no longer covers'),
    'the sentence says the entitlement ended, which the provider receipt does not',
  )
}

// --- the cancelled classes --------------------------------------------------
// Cancelling booked classes silently is not acceptable, so they are named.
{
  const line = cancelledClassesLine([
    { name: 'Vinyasa Flow', startsAt: new Date('2026-09-02T23:00:00Z') },
    { name: 'Yin Yoga', startsAt: new Date('2026-09-05T00:30:00Z') },
  ])
  assert.ok(line.includes('Vinyasa Flow'), 'the first class is named')
  assert.ok(line.includes('Yin Yoga'), 'the second class is named')
  // 2026-09-02T23:00Z is the 3rd in Singapore.
  assert.ok(line.includes('3 Sept 2026'), 'the class time is read in Singapore, not UTC')
  assert.ok(line.includes('2 upcoming bookings'), 'the count agrees with the list')
}

// The empty case says so out loud rather than rendering a dangling colon.
{
  const line = cancelledClassesLine([])
  assert.ok(line.includes('no upcoming bookings'), 'nothing cancelled is stated, not omitted')
  assert.ok(!line.includes(':'), 'no dangling list punctuation when there is no list')
}

// One booking takes the singular.
{
  const line = cancelledClassesLine([
    { name: 'Hatha', startsAt: new Date('2026-09-02T23:00:00Z') },
  ])
  assert.ok(line.includes('1 upcoming booking:'), 'the singular is spelled out')
}

// --- the whole email --------------------------------------------------------
// Every declared variable is filled. A blank one renders as a hole in the copy,
// and this email exists precisely to not leave holes.
{
  const { slug, variables } = composeRefundEmail({
    clientName: 'Sarah',
    packageName: '10-Class Pack',
    amountSgd: '280.00',
    cancelled: [{ name: 'Vinyasa Flow', startsAt: new Date('2026-09-02T23:00:00Z') }],
    accountUrl: 'https://example.test/account',
  })
  assert.strictEqual(slug, 'purchase_refunded', 'the refund has its own slug')
  for (const [k, v] of Object.entries(variables)) {
    assert.ok(v.length > 0, `variable ${k} is filled`)
  }
  assert.ok(
    variables.cancelled_line?.includes('Vinyasa Flow'),
    'the cancelled class reaches the email',
  )
}

// --- silence (#95) ----------------------------------------------------------
// The clock runs from the LAST payment. A member who paid a second card
// yesterday is mid-purchase; one who paid once a month ago has gone quiet.
{
  const now = new Date('2026-09-07T00:00:00Z')
  const yesterday = new Date('2026-09-06T00:00:00Z')
  const monthAgo = new Date('2026-08-07T00:00:00Z')

  assert.strictEqual(daysSilent(yesterday, now), 1)
  assert.strictEqual(isSilent(yesterday, now), false, 'a day is not silence')
  assert.strictEqual(isSilent(monthAgo, now), true, 'a month is')

  // The boundary is inclusive: on the fourteenth day it is raised, not on the
  // fifteenth. One place decides it, so the list and the notice cannot disagree.
  const onTheDay = new Date(now.getTime() - SILENT_AFTER_DAYS * 86_400_000)
  assert.strictEqual(isSilent(onTheDay, now), true, 'the threshold day counts as silent')
  const dayBefore = new Date(onTheDay.getTime() + 1)
  assert.strictEqual(isSilent(dayBefore, now), false, 'a moment short of it does not')
}

// The notice names both the length of the silence and the date, because an
// admin chasing this needs the second to find it on a statement.
{
  const now = new Date('2026-09-07T00:00:00Z')
  const line = silenceNotice(new Date('2026-08-07T00:00:00Z'), now)
  assert.ok(line.includes('31 days'), 'the silence is counted in days')
  assert.ok(line.includes('7 Aug 2026'), 'the last payment date is read in Singapore')
}

// --- what an abandoned refund returned --------------------------------------
// The count and the total together: one button becomes one provider call per
// payment, so a split purchase puts two lines on the statement.
{
  assert.strictEqual(abandonedReturnLine(1, '50.00'), '1 payment returned, totalling S$50.00')
  assert.strictEqual(abandonedReturnLine(2, '120.00'), '2 payments returned, totalling S$120.00')
}

// The abandoned sentence must NOT claim a package stopped covering bookings —
// there was never one to end.
{
  const line = abandonedLine('10-Class Pack', '50.00')
  assert.ok(line.includes('S$50.00'), 'the amount returned is named')
  assert.ok(line.includes('10-Class Pack'), 'what they were buying is named')
  assert.ok(!line.includes('no longer covers'), 'nothing was ever covering anything')
}

// --- the abandoned email ----------------------------------------------------
// Same template, different sentences. Every declared variable is filled — an
// empty one renders as a hole, and `cancelled_line` has no list to print.
{
  const { slug, variables } = composeAbandonedRefundEmail({
    clientName: 'Sarah',
    itemName: '10-Class Pack',
    amountSgd: '50.00',
    accountUrl: 'https://example.test/account',
  })
  assert.strictEqual(slug, 'purchase_refunded', 'it reuses the refund template')
  for (const [k, v] of Object.entries(variables)) {
    assert.ok(v.length > 0, `variable ${k} is filled`)
  }
  assert.ok(
    variables.cancelled_line?.includes('nothing to cancel'),
    'the member is told plainly that nothing was taken away',
  )
}

console.log('refund-notice ok')
