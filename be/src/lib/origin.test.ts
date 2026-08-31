import assert from 'node:assert'
import { describe, test } from 'node:test'
import {
  isAllowedOrigin,
  parseOriginPattern,
  parseOriginPatterns,
  tenantSlugFromOrigin,
} from './origin'

const PRODUCTION = parseOriginPatterns(
  'https://*.reservetoday.app,https://*.portal.reservetoday.app',
)
const STAGING = parseOriginPatterns(
  'https://*.dev.reservetoday.app,https://*.portal.dev.reservetoday.app',
)
const LOCAL = parseOriginPatterns(
  'http://localhost:3000,http://*.localhost:3000,http://*.portal.localhost:3001',
)

describe('origin patterns', () => {
  test('an exact origin matches only itself', () => {
    const patterns = parseOriginPatterns('https://portal.reservetoday.app')
    assert.equal(isAllowedOrigin('https://portal.reservetoday.app', patterns), true)
    assert.equal(isAllowedOrigin('https://acme.reservetoday.app', patterns), false)
    // Neither the protocol nor the port is negotiable.
    assert.equal(isAllowedOrigin('http://portal.reservetoday.app', patterns), false)
    assert.equal(isAllowedOrigin('https://portal.reservetoday.app:8443', patterns), false)
  })

  test('a wildcard matches exactly one label, never two', () => {
    assert.equal(isAllowedOrigin('https://acme.reservetoday.app', PRODUCTION), true)
    assert.equal(isAllowedOrigin('https://yogasadhana.reservetoday.app', PRODUCTION), true)
    // The bare root domain is not a tenant, and a two-label host is one no
    // certificate in this scheme can cover.
    assert.equal(isAllowedOrigin('https://reservetoday.app', PRODUCTION), false)
    assert.equal(isAllowedOrigin('https://deep.nested.reservetoday.app', PRODUCTION), false)
  })

  test('the portal wildcard is a separate pattern, not a deeper match', () => {
    assert.equal(isAllowedOrigin('https://acme.portal.reservetoday.app', PRODUCTION), true)
    // …and it is the portal pattern that admits it, not the client one: with
    // only the client pattern configured, the portal host is refused.
    const clientOnly = parseOriginPatterns('https://*.reservetoday.app')
    assert.equal(isAllowedOrigin('https://acme.portal.reservetoday.app', clientOnly), false)
  })

  test('staging is the same algorithm with a different suffix', () => {
    assert.equal(isAllowedOrigin('https://acme.dev.reservetoday.app', STAGING), true)
    assert.equal(isAllowedOrigin('https://acme.portal.dev.reservetoday.app', STAGING), true)
    // A staging origin must not be admitted by the production allowlist.
    assert.equal(isAllowedOrigin('https://acme.dev.reservetoday.app', PRODUCTION), false)
  })

  test('a suffix that merely ends in the pattern is not a match', () => {
    assert.equal(isAllowedOrigin('https://evilreservetoday.app', PRODUCTION), false)
    assert.equal(isAllowedOrigin('https://acme.reservetoday.app.evil.com', PRODUCTION), false)
  })

  test('the wildcard label is the tenant slug', () => {
    assert.equal(tenantSlugFromOrigin('https://acme.reservetoday.app', PRODUCTION), 'acme')
    assert.equal(
      tenantSlugFromOrigin('https://yogasadhana.portal.reservetoday.app', PRODUCTION),
      'yogasadhana',
    )
    assert.equal(tenantSlugFromOrigin('http://acme.localhost:3000', LOCAL), 'acme')
    assert.equal(
      tenantSlugFromOrigin('http://yogasadhana.portal.localhost:3001', LOCAL),
      'yogasadhana',
    )
  })

  test('an origin that names no tenant yields null, not a guess', () => {
    // Allowlisted, but single-tenant: local development on the bare host.
    assert.equal(isAllowedOrigin('http://localhost:3000', LOCAL), true)
    assert.equal(tenantSlugFromOrigin('http://localhost:3000', LOCAL), null)
    // Not allowlisted at all — same answer, because neither is evidence about
    // which tenant the caller meant.
    assert.equal(tenantSlugFromOrigin('https://evil.example.com', PRODUCTION), null)
    assert.equal(tenantSlugFromOrigin('not a url', PRODUCTION), null)
  })

  test('the host casing is normalised, since DNS is case-insensitive', () => {
    assert.equal(tenantSlugFromOrigin('https://ACME.ReserveToday.app', PRODUCTION), 'acme')
  })

  test('an unparseable pattern is dropped rather than widening the allowlist', () => {
    assert.equal(parseOriginPattern(''), null)
    assert.equal(parseOriginPattern('   '), null)
    assert.equal(parseOriginPattern('reservetoday.app'), null)
    // A `*` that is not the leftmost label is refused outright.
    assert.equal(parseOriginPattern('https://portal.*.reservetoday.app'), null)
    // …and a dropped entry does not take the valid ones with it.
    const mixed = parseOriginPatterns('https://portal.*.reservetoday.app,https://*.reservetoday.app')
    assert.equal(mixed.length, 1)
    assert.equal(isAllowedOrigin('https://acme.reservetoday.app', mixed), true)
  })

  test('patterns from several sources merge, and duplicates collapse', () => {
    const merged = parseOriginPatterns(
      'https://portal.reservetoday.app',
      'https://*.reservetoday.app, https://portal.reservetoday.app',
      undefined,
    )
    assert.equal(merged.length, 2)
  })
})
