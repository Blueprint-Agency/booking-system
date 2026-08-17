import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEmailTemplates } from './email-copy'
import { TEMPLATE_VARIABLES } from '../../services/notifications/variables'

// Dummy origins: the real ones come from `../../env` at seed time, and this
// check has no environment to read. Nothing here asserts on the host.
const SEEDED_TEMPLATES = buildEmailTemplates({
  clientUrl: 'https://app.test',
  portalUrl: 'https://portal.test',
})

/**
 * The check that would have caught the placeholder body: a template whose
 * variables and the sender's variables have drifted apart renders a blank
 * email, and nothing else in the system notices — the renderer substitutes an
 * unknown `{{var}}` with an empty string on purpose.
 */

const varsIn = (html: string) => new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]!))

test('every slug the senders know is seeded, and vice versa', () => {
  const seeded = new Set(SEEDED_TEMPLATES.map(t => t.slug))
  const declared = new Set(Object.keys(TEMPLATE_VARIABLES))
  assert.deepEqual([...declared].filter(s => !seeded.has(s)), [], 'declared but not seeded')
  assert.deepEqual([...seeded].filter(s => !declared.has(s)), [], 'seeded but not declared')
})

test('each template uses exactly its allow-listed variables', () => {
  for (const t of SEEDED_TEMPLATES) {
    const allowed = new Set(TEMPLATE_VARIABLES[t.slug as keyof typeof TEMPLATE_VARIABLES] ?? [])
    const used = new Set([...varsIn(t.subject), ...varsIn(t.bodyHtml)])
    assert.deepEqual([...used].filter(v => !allowed.has(v)), [], `${t.slug}: renders empty — not allow-listed`)
    assert.deepEqual([...allowed].filter(v => !used.has(v)), [], `${t.slug}: allow-listed but never shown`)
  }
})

test('no template is a bare name (the §13 placeholder bug)', () => {
  for (const t of SEEDED_TEMPLATES) {
    // Strip tags and variables: what is left is the copy a member actually reads.
    const prose = t.bodyHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{\w+\}\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    assert.ok(prose.length > 120, `${t.slug}: body has almost no copy in it`)
    assert.ok(t.bodyHtml.includes('Yoga Sadhana'), `${t.slug}: missing the studio's branding`)
    assert.ok(t.subject.trim().length > 0, `${t.slug}: empty subject`)
  }
})
