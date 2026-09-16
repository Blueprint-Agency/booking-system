import assert from 'node:assert/strict'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import { hashPassword } from 'better-auth/crypto'
import { isBcryptDigest, verifyPoolPassword } from './password-hash'

test('a bcrypt digest carried over by the user import verifies against its password (#120)', async () => {
  const hash = await bcrypt.hash('imported-password', 10)
  assert.equal(await verifyPoolPassword({ hash, password: 'imported-password' }), true)
  assert.equal(await verifyPoolPassword({ hash, password: 'not-it' }), false)
})

test("a password Better Auth hashed itself still verifies the way it always did", async () => {
  const hash = await hashPassword('chosen-after-the-swap')
  assert.equal(await verifyPoolPassword({ hash, password: 'chosen-after-the-swap' }), true)
  assert.equal(await verifyPoolPassword({ hash, password: 'not-it' }), false)
})

test('every bcrypt variant is recognised, and nothing else is', () => {
  for (const prefix of ['$2a$', '$2b$', '$2y$']) assert.equal(isBcryptDigest(`${prefix}10$abcdefghijklmnopqrstuv`), true)
  assert.equal(isBcryptDigest('0123abcd:ef45'), false)
  assert.equal(isBcryptDigest('$argon2id$v=19$m=65536'), false)
})
