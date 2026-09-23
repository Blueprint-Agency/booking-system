import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderTemplate } from './render'

test('NTF-21 a variable the sender does not supply renders as blank', () => {
  assert.equal(
    renderTemplate('Hi {{first_name}}, your {{no_such_variable}}class is booked.', { first_name: 'Ana' }),
    'Hi Ana, your class is booked.',
  )
})

test('a supplied value is escaped, and the template around it is left as written', () => {
  assert.equal(renderTemplate('<p>{{name}}</p>', { name: '<b>O\'Neill & co</b>' }), '<p>&lt;b&gt;O&#39;Neill &amp; co&lt;/b&gt;</p>')
})
