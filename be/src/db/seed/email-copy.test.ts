import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEmailTemplates, type EmailStudio } from './email-copy'
import { TEMPLATE_VARIABLES } from '../../services/notifications/variables'

// Dummy origins: the real ones come from `../../env` at seed time, and this
// check has no environment to read. Nothing here asserts on the host.
//
// The studio is invented for the same reason: the copy module must have no
// studio of its own to fall back to, so a test that named a real one could pass
// on a hardcoded string.
const STUDIO: EmailStudio = { name: 'Test Studio', footer: 'One Test Street.' }

const build = (studio: EmailStudio = STUDIO) =>
  buildEmailTemplates({
    clientUrl: 'https://app.test',
    portalUrl: 'https://portal.test',
    studio,
  })

const SEEDED_TEMPLATES = build()

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
    // Strip tags and variables: what is left is the copy a member actually
    // reads. The shell's own chrome — the studio's name in the mark and again
    // in the footer — comes out too, because it is the same on every template
    // and would otherwise pad a bare one over the bar. That padding is exactly
    // what a longer studio name would have quietly bought before #66 made the
    // name a variable.
    const prose = t.bodyHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{\w+\}\}/g, '')
      .split(STUDIO.name)
      .join(' ')
      .split(STUDIO.footer!)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    assert.ok(prose.length > 60, `${t.slug}: body has almost no copy of its own`)
    assert.ok(t.bodyHtml.includes(STUDIO.name), `${t.slug}: missing the studio's branding`)
    assert.ok(t.subject.trim().length > 0, `${t.slug}: empty subject`)
  }
})

/**
 * #66: the copy is the TENANT's, not the product's.
 *
 * The failure this rules out is the one the module started with — a studio name
 * baked into thirty templates, so every tenant's members read the first
 * tenant's name. Building the same set twice for two studios and finding no
 * trace of one in the other is the only check that catches a single missed
 * literal, because a missed literal still renders and still ships.
 */
test('a second studio gets its own name everywhere, and no trace of the first', () => {
  const second = build({ name: 'Second Studio', footer: 'Two Other Road.' })
  assert.equal(second.length, SEEDED_TEMPLATES.length)

  for (const t of second) {
    const whole = `${t.subject}\n${t.bodyHtml}`
    assert.ok(!whole.includes(STUDIO.name), `${t.slug}: still names the other studio`)
    assert.ok(!whole.includes(STUDIO.footer!), `${t.slug}: still carries the other footer`)
    assert.ok(whole.includes('Second Studio'), `${t.slug}: never names its own studio`)
  }
})

test('the mark is derived from the name when none is given', () => {
  // An initial per word — the mark is a square, not a label.
  const [first] = build({ name: 'Second Studio' })
  assert.ok(first!.bodyHtml.includes('>SS</div>'))
})

test("a studio's name is escaped before it reaches the HTML", () => {
  // Tenant-supplied text stored as HTML and mailed later: an unescaped `<`
  // would be markup in every one of these emails.
  const [first] = build({ name: '<script>x</script> & Co' })
  assert.ok(!first!.bodyHtml.includes('<script>'), 'raw markup reached the body')
  assert.ok(first!.bodyHtml.includes('&lt;script&gt;'))
})

test('a studio with no premises on record gets its name alone in the footer', () => {
  const [first] = build({ name: 'Second Studio' })
  // Never someone else's address, and never a dangling em dash.
  assert.ok(!first!.bodyHtml.includes('Second Studio —'))
})
