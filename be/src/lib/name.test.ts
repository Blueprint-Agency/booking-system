import assert from 'node:assert'
import { splitName, joinName } from './name'

assert.deepStrictEqual(splitName('Anya'), { firstName: 'Anya', lastName: null })
assert.deepStrictEqual(splitName('Anya Sharma'), { firstName: 'Anya', lastName: 'Sharma' })
assert.deepStrictEqual(splitName('Anya Devi Sharma'), { firstName: 'Anya', lastName: 'Devi Sharma' })
assert.deepStrictEqual(splitName('  Anya   Sharma  '), { firstName: 'Anya', lastName: 'Sharma' })
assert.strictEqual(joinName('Anya', 'Sharma'), 'Anya Sharma')
assert.strictEqual(joinName('Anya', null), 'Anya')
assert.strictEqual(joinName('Anya', ''), 'Anya')
console.log('name.test ok')
