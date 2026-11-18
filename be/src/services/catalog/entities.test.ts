import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { assertEntityUnused } from './entities-usage'

/**
 * Nothing belongs to an Entity yet, so the refusal for "still in use" cannot be
 * reached over HTTP. The rule is a pure function of the counts, which the
 * package and Class Type changes will fill in; it is proven here so that when
 * they do, the answer is already the one the admin screen reads.
 */
describe('an Entity still in use is not archived', () => {
  test('SCH-61 any count above zero is refused 409 entity_in_use carrying every count, and all zeros pass', () => {
    assert.doesNotThrow(() =>
      assertEntityUnused({ class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 }),
    )

    const usage = { class_types: 2, class_packages: 0, pt_packages: 1, corporate_packages: 0 }
    assert.throws(
      () => assertEntityUnused(usage),
      (err: any) => {
        assert.equal(err.status, 409)
        assert.equal(err.code, 'entity_in_use')
        assert.deepEqual(err.details, usage)
        return true
      },
    )

    for (const kind of Object.keys(usage) as Array<keyof typeof usage>) {
      const only = { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0, [kind]: 1 }
      assert.throws(() => assertEntityUnused(only), /./, `${kind} alone blocks`)
    }
  })
})
