import assert from 'node:assert'
import { SLOT_CRON, SLOT_MINUTES, localClock, isDailySlot } from './local-time'

// ---------- the grid ----------
{
  assert.equal(SLOT_MINUTES, 15)
  assert.equal(SLOT_CRON, '*/15 * * * *')
}

// ---------- localClock reads the zone, not the server ----------
{
  // 2026-06-01T17:00:00Z
  const at = new Date(Date.UTC(2026, 5, 1, 17, 0))
  assert.deepEqual(localClock('UTC', at), { hour: 17, minute: 0 })
  assert.deepEqual(localClock('Asia/Singapore', at), { hour: 1, minute: 0 }) // +08:00
  assert.deepEqual(localClock('Asia/Kolkata', at), { hour: 22, minute: 30 }) // +05:30
  assert.deepEqual(localClock('America/New_York', at), { hour: 13, minute: 0 }) // EDT, -04:00
}

// Midnight must read as hour 0, never 24 — the h23 cycle is load-bearing.
{
  const at = new Date(Date.UTC(2026, 0, 15, 16, 0))
  assert.deepEqual(localClock('Asia/Singapore', at), { hour: 0, minute: 0 })
}

// Daylight saving is read off the date, not off a stored offset.
{
  const winter = new Date(Date.UTC(2026, 0, 15, 17, 0))
  const summer = new Date(Date.UTC(2026, 6, 15, 17, 0))
  assert.deepEqual(localClock('Europe/London', winter), { hour: 17, minute: 0 }) // GMT
  assert.deepEqual(localClock('Europe/London', summer), { hour: 18, minute: 0 }) // BST
}

// An unknown zone is a RangeError, so one bad tenant row is visible rather than
// silently running on the server's clock.
{
  assert.throws(() => localClock('Mars/Olympus', new Date()), RangeError)
}

// ---------- a tenant in another timezone fires at its own local time ----------
{
  // The 01:00 daily job (package expiry), over a full UTC day on the 15-minute
  // grid. Each tenant must fire exactly once, at its own 01:00.
  const DAY = Date.UTC(2026, 5, 1)
  const slots: Date[] = []
  for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) slots.push(new Date(DAY + m * 60_000))

  const firedAt = (timezone: string) => slots.filter(at => isDailySlot(timezone, 1, at))

  const sg = firedAt('Asia/Singapore')
  assert.equal(sg.length, 1, 'Asia/Singapore fires once a day')
  assert.deepEqual(localClock('Asia/Singapore', sg[0]!), { hour: 1, minute: 0 })

  // The whole point of the ticket: a studio outside Singapore.
  const ny = firedAt('America/New_York')
  assert.equal(ny.length, 1, 'America/New_York fires once a day')
  assert.deepEqual(localClock('America/New_York', ny[0]!), { hour: 1, minute: 0 })
  // …and not at Singapore's moment.
  assert.notEqual(ny[0]!.getTime(), sg[0]!.getTime())

  // A half-hour zone still lands on its own hour boundary.
  const kolkata = firedAt('Asia/Kolkata')
  assert.equal(kolkata.length, 1, 'Asia/Kolkata fires once a day')
  assert.deepEqual(localClock('Asia/Kolkata', kolkata[0]!), { hour: 1, minute: 0 })

  // A quarter-hour zone too.
  const kathmandu = firedAt('Asia/Kathmandu')
  assert.equal(kathmandu.length, 1, 'Asia/Kathmandu fires once a day')
  assert.deepEqual(localClock('Asia/Kathmandu', kathmandu[0]!), { hour: 1, minute: 0 })

  // Every daily hour the jobs use behaves the same way.
  for (const hour of [1, 2, 8]) {
    for (const zone of ['Asia/Singapore', 'America/New_York', 'Europe/London', 'Pacific/Auckland']) {
      const fired = slots.filter(at => isDailySlot(zone, hour, at))
      assert.equal(fired.length, 1, `${zone} @ ${hour}:00 fires once`)
      assert.deepEqual(localClock(zone, fired[0]!), { hour, minute: 0 })
    }
  }
}

// A slot inside the hour but past the first quarter must not fire again.
{
  const at = new Date(Date.UTC(2026, 5, 1, 17, 30)) // 01:30 in Singapore
  assert.equal(isDailySlot('Asia/Singapore', 1, at), false)
}
