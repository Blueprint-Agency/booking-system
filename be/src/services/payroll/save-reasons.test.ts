import assert from 'node:assert'
import {
  payrollSaveFailed,
  payrollSaveMessage,
  payrollSaveStatus,
  type PayrollSaveReason,
} from './save-reasons'

const REASONS: PayrollSaveReason[] = [
  'record_not_found',
  'instructor_not_assigned',
  'invalid_amount',
  'instructor_required',
]

// --- the whole point: every reason gets its own status AND its own sentence ---
assert.strictEqual(payrollSaveStatus.record_not_found, 404)
assert.strictEqual(payrollSaveStatus.instructor_not_assigned, 409)
assert.strictEqual(payrollSaveStatus.invalid_amount, 400)
assert.strictEqual(payrollSaveStatus.instructor_required, 400)

const messages = REASONS.map(r => payrollSaveMessage(r, 'class'))
assert.strictEqual(new Set(messages).size, REASONS.length, 'two reasons share one sentence')
assert.ok(messages.every(m => m.length > 0))

// --- the kind is named, so "class" and "private session" don't read alike ----
assert.match(payrollSaveMessage('record_not_found', 'pt'), /private session/)
assert.match(payrollSaveMessage('record_not_found', 'class'), /class/)
assert.match(payrollSaveMessage('instructor_required', 'workshop'), /workshop/)

// --- a manual entry can't be cleared to nothing; a session can --------------
assert.notStrictEqual(
  payrollSaveMessage('invalid_amount', 'manual'),
  payrollSaveMessage('invalid_amount', 'class'),
)

// --- the failure arm carries the reason, and stays narrowable ---------------
const failed = payrollSaveFailed('instructor_not_assigned')
assert.strictEqual(failed.ok, false)
assert.strictEqual(failed.ok === false && failed.reason, 'instructor_not_assigned')

console.log('save-reasons.test ok')
