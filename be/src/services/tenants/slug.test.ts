import assert from 'node:assert'
import { RESERVED_SLUGS, checkSlug, assertUsableSlug } from './slug'

// ---------- accepts ----------
{
  assert.deepEqual(checkSlug('yogasadhana'), { ok: true, slug: 'yogasadhana' })
  assert.deepEqual(checkSlug('acme'), { ok: true, slug: 'acme' })
  assert.deepEqual(checkSlug('yoga-sadhana-2'), { ok: true, slug: 'yoga-sadhana-2' })
  // Normalised, not rejected: the caller may be echoing a form field.
  assert.deepEqual(checkSlug('  YogaSadhana '), { ok: true, slug: 'yogasadhana' })
}

// ---------- reserved ----------
{
  // Every reserved slug in the plan, verbatim. `admin` is the one that matters
  // most: it is the super portal's own hostname.
  for (const reserved of [
    'admin',
    'api',
    'portal',
    'www',
    'dev',
    'staging',
    'app',
    'mail',
    'clerk',
    'assets',
  ]) {
    assert.ok(RESERVED_SLUGS.includes(reserved), `${reserved} must be reserved`)
    assert.deepEqual(checkSlug(reserved), { ok: false, reason: 'slug_reserved' })
    // Casing and padding must not smuggle a reserved slug through.
    assert.deepEqual(checkSlug(reserved.toUpperCase()), { ok: false, reason: 'slug_reserved' })
  }
}

// ---------- malformed ----------
{
  assert.deepEqual(checkSlug(''), { ok: false, reason: 'slug_too_short' })
  assert.deepEqual(checkSlug('ab'), { ok: false, reason: 'slug_too_short' })
  assert.deepEqual(checkSlug('a'.repeat(64)), { ok: false, reason: 'slug_too_long' })
  assert.deepEqual(checkSlug('yoga sadhana'), { ok: false, reason: 'slug_malformed' })
  assert.deepEqual(checkSlug('yoga_sadhana'), { ok: false, reason: 'slug_malformed' })
  assert.deepEqual(checkSlug('yoga.sadhana'), { ok: false, reason: 'slug_malformed' })
  // A hostname label may not start or end with a hyphen.
  assert.deepEqual(checkSlug('-yoga'), { ok: false, reason: 'slug_malformed' })
  assert.deepEqual(checkSlug('yoga-'), { ok: false, reason: 'slug_malformed' })
  // Punycode prefix — reserved by IDNA for encoded labels.
  assert.deepEqual(checkSlug('xn--abc'), { ok: false, reason: 'slug_malformed' })
}

// ---------- assertUsableSlug ----------
{
  assert.equal(assertUsableSlug(' ACME '), 'acme')
  assert.throws(() => assertUsableSlug('admin'), (err: { code?: string; status?: number }) => {
    assert.equal(err.code, 'slug_reserved')
    assert.equal(err.status, 400)
    return true
  })
  assert.throws(() => assertUsableSlug('nope!'), (err: { code?: string }) => {
    assert.equal(err.code, 'slug_malformed')
    return true
  })
}

console.log('slug tests passed')
