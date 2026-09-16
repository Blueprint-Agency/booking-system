import assert from 'node:assert'
import { isPlatformAdmin, parsePlatformAdmins } from './platform-admin'

// ---------- parsing ----------
{
  assert.deepEqual(parsePlatformAdmins(undefined), [])
  assert.deepEqual(parsePlatformAdmins(null), [])
  assert.deepEqual(parsePlatformAdmins(''), [])
  assert.deepEqual(parsePlatformAdmins('a@x.com'), ['a@x.com'])
  assert.deepEqual(parsePlatformAdmins('a@x.com,b@y.com'), ['a@x.com', 'b@y.com'])
  // Whitespace and casing are normalised, not rejected — the value is typed by
  // hand into a deploy environment.
  assert.deepEqual(parsePlatformAdmins(' A@X.com , B@Y.com '), ['a@x.com', 'b@y.com'])
  // A trailing comma must not leave a blank entry that a blank email matches.
  assert.deepEqual(parsePlatformAdmins('a@x.com,,'), ['a@x.com'])
  // Several sources fold into one list, de-duplicated: SUPERADMIN_EMAIL is
  // always included and may well also appear in PLATFORM_ADMIN_EMAILS.
  assert.deepEqual(parsePlatformAdmins('a@x.com,b@y.com', 'A@x.com'), ['a@x.com', 'b@y.com'])
}

// ---------- membership ----------
{
  const list = parsePlatformAdmins('dev@teeko.ai, ops@teeko.ai')
  assert.equal(isPlatformAdmin('dev@teeko.ai', list), true)
  assert.equal(isPlatformAdmin('DEV@Teeko.ai', list), true)
  assert.equal(isPlatformAdmin('  dev@teeko.ai  ', list), true)
  assert.equal(isPlatformAdmin('someone@else.com', list), false)
}

// ---------- refuses the absent ----------
{
  // A blank allowlist admits nobody, however the address is spelled.
  assert.equal(isPlatformAdmin('dev@teeko.ai', []), false)
  // A Clerk account with no primary email must not match a blank entry.
  assert.equal(isPlatformAdmin(null, parsePlatformAdmins('a@x.com,,')), false)
  assert.equal(isPlatformAdmin('', parsePlatformAdmins('a@x.com,,')), false)
  assert.equal(isPlatformAdmin('   ', parsePlatformAdmins('a@x.com,,')), false)
}
