import assert from 'node:assert'
import { staffEditRefusal } from './staff-rank'

const plain = { touchesPrivilegeFields: false }
const privileged = { touchesPrivilegeFields: true }

// --- higher rank is refused, equal and lower rank are allowed ---------------
assert.strictEqual(
  staffEditRefusal({ actorRole: 'admin', targetRole: 'superadmin', ...plain }),
  'outranked_staff_edit_forbidden',
)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'instructor', targetRole: 'admin', ...plain }),
  'outranked_staff_edit_forbidden',
)
assert.strictEqual(staffEditRefusal({ actorRole: 'admin', targetRole: 'admin', ...plain }), null)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'admin', targetRole: 'instructor', ...plain }),
  null,
)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'superadmin', targetRole: 'superadmin', ...plain }),
  null,
)

// --- role / location grants: superadmin only, refused for anyone else -------
assert.strictEqual(
  staffEditRefusal({ actorRole: 'admin', targetRole: 'instructor', ...privileged }),
  'privilege_fields_superadmin_only',
)
// the escalation path: admin patching their own role
assert.strictEqual(
  staffEditRefusal({ actorRole: 'admin', targetRole: 'admin', ...privileged }),
  'privilege_fields_superadmin_only',
)
assert.strictEqual(
  staffEditRefusal({ actorRole: 'superadmin', targetRole: 'admin', ...privileged }),
  null,
)

// --- rank is checked before the privilege fields ----------------------------
assert.strictEqual(
  staffEditRefusal({ actorRole: 'admin', targetRole: 'superadmin', ...privileged }),
  'outranked_staff_edit_forbidden',
)
