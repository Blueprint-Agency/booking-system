import assert from 'node:assert'
import {
  attendedNotice,
  cancelledClassesLine,
  composeRefundEmail,
  isUntouched,
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

console.log('refund-notice ok')
