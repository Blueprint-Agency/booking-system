import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STUDIO_EMAILS } from './switches'
import { TEMPLATE_VARIABLES } from './variables'

const MEMBER_SWITCHABLE = [
  'class_booking_confirmed',
  'class_cancelled_credit_returned',
  'class_cancelled_forfeited',
  'pt_cancelled_session_returned',
  'pt_cancelled_forfeited',
  'pt_request_submitted',
  'credit_expiry_reminder',
]
const MEMBER_LOCKED = [
  'sign_in_code',
  'password_reset',
  'client_invite',
  'package_purchase_confirmed',
  'trial_pass_purchase_confirmed',
  'corporate_purchase_confirmed',
  'purchase_receipt',
  'workshop_purchase_confirmed',
  'purchase_refunded',
  'admin_cancel_class',
  'admin_cancel_pt',
  'admin_cancel_workshop',
  'class_rule_cancelled',
  'pt_request_cancelled',
  'pt_session_approved',
  'pt_request_expired',
  'class_waitlist_promoted',
]
const STAFF_SWITCHABLE = ['checkin_nag', 'instructor_cancel_class', 'classpass_overbooked', 'leave_request_submitted', 'leave_approved', 'leave_rejected', 'leave_revoked']
const STAFF_LOCKED = ['staff_two_factor_code', 'staff_password_reset', 'admin_invite', 'instructor_invite', 'staff_email_change_link', 'staff_email_changed_notice']

// Seeded, and no sender yet: a private-session request is never declined in the
// app (staff schedule or cancel it), and a workshop has no waitlist to promote from.
const NO_SENDER = ['pt_session_declined', 'workshop_waitlist_promoted']

const sorted = (slugs: Iterable<string>) => [...slugs].sort()

test('NTF-38 every email a studio sends is classified to members or staff, and locked or switchable, as the spec lists it', () => {
  const expected = [
    ...MEMBER_SWITCHABLE.map(slug => [slug, { audience: 'member', locked: false }] as const),
    ...MEMBER_LOCKED.map(slug => [slug, { audience: 'member', locked: true }] as const),
    ...STAFF_SWITCHABLE.map(slug => [slug, { audience: 'staff', locked: false }] as const),
    ...STAFF_LOCKED.map(slug => [slug, { audience: 'staff', locked: true }] as const),
  ]
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(STUDIO_EMAILS)
        .map(([slug, { audience, locked }]) => [slug, { audience, locked }] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    Object.fromEntries(expected.sort(([a], [b]) => a.localeCompare(b))),
  )
})

test('NTF-38 every classified email has a plain-language name of its own, not its slug', () => {
  const names = Object.entries(STUDIO_EMAILS).map(([slug, { name }]) => {
    assert.ok(name.trim() !== '', `${slug} has no name`)
    assert.ok(!name.includes('_'), `${slug} is named ${name}`)
    return name
  })
  assert.equal(new Set(names).size, names.length, 'two emails share a name')
})

test('NTF-38 a template slug is either classified or one no sender uses, so a new email cannot ship unclassified', () => {
  const classified = new Set(Object.keys(STUDIO_EMAILS))
  const unclassified = Object.keys(TEMPLATE_VARIABLES).filter(slug => !classified.has(slug))
  assert.deepEqual(sorted(unclassified), sorted(NO_SENDER))
})
