import assert from 'node:assert'
import { staffEditRefusal } from './staff-rank'

const plain = { touchesPrivilegeFields: false }
const privileged = { touchesPrivilegeFields: true }

// --- an instructor cannot edit an admin -------------------------------------
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'admin', ...plain }),
  'outranked_staff_edit_forbidden',
)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'superadmin', ...plain }),
  'outranked_staff_edit_forbidden',
)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'instructor', ...plain }),
  null,
)

// --- an admin can edit anyone, a superadmin included -------------------------
for (const targetRole of ['superadmin', 'admin', 'instructor'] as const) {
  assert.strictEqual(staffEditRefusal({ actorRole: 'admin', targetRole, ...plain }), null)
  assert.strictEqual(staffEditRefusal({ actorRole: 'superadmin', targetRole, ...plain }), null)
}

// --- only an admin (or the superadmin it is replacing) changes a role --------
for (const targetRole of ['superadmin', 'admin', 'instructor'] as const) {
  assert.strictEqual(staffEditRefusal({ actorRole: 'admin', targetRole, ...privileged }), null)
  assert.strictEqual(staffEditRefusal({ actorRole: 'superadmin', targetRole, ...privileged }), null)
}
// the escalation path: an instructor patching their own role
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'instructor', ...privileged }),
  'privilege_fields_admin_only',
)

// --- rank is checked before the privilege fields ----------------------------
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'admin', ...privileged }),
  'outranked_staff_edit_forbidden',
)
