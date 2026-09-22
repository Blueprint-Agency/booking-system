import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEmailTemplates, type EmailStudio } from './email-copy'
import { TEMPLATE_VARIABLES } from '../../services/notifications/variables'
import { frameTemplatedEmail } from '../../services/notifications/frame'

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

/** A stored template as it is mailed: rendered and wrapped in the shared design. */
const framed = (t: { slug: string; subject: string; bodyHtml: string }, studioName: string) =>
  frameTemplatedEmail({ slug: t.slug, recipientKind: 'client', studioName, template: t, variables: {} })

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
    assert.ok(framed(t, STUDIO.name).html.includes(STUDIO.name), `${t.slug}: missing the studio's branding`)
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
    const mailed = framed(t, 'Second Studio')
    const whole = `${t.subject}\n${t.bodyHtml}\n${mailed.html}\n${mailed.text}`
    assert.ok(!whole.includes(STUDIO.name), `${t.slug}: still names the other studio`)
    assert.ok(!whole.includes(STUDIO.footer!), `${t.slug}: still carries the other footer`)
    assert.ok(mailed.html.includes('Second Studio'), `${t.slug}: never names its own studio`)
    assert.ok(t.bodyHtml.includes('Two Other Road.'), `${t.slug}: lost its own premises`)
  }
})

test('the mark is derived from the name', () => {
  // An initial per word — the mark is a square, not a label.
  const [first] = build({ name: 'Second Studio' })
  assert.ok(framed(first!, 'Second Studio').html.includes('>SS</td>'))
})

test("a studio's name is escaped before it reaches the HTML", () => {
  // Tenant-supplied text stored as HTML and mailed later: an unescaped `<`
  // would be markup in every one of these emails.
  const name = '<script>x</script> & Co'
  for (const t of build({ name })) {
    const mailed = framed(t, name)
    for (const html of [t.bodyHtml, mailed.html]) {
      assert.ok(!html.includes('<script>'), `${t.slug}: raw markup reached the body`)
    }
    assert.ok(mailed.html.includes('&lt;script&gt;'))
  }
})

test('a studio with no premises on record gets its name alone in the footer', () => {
  const [first] = build({ name: 'Second Studio' })
  // Never someone else's address, and never a dangling em dash.
  const mailed = framed(first!, 'Second Studio')
  assert.ok(!mailed.text.includes('Second Studio —'))
  assert.ok(!first!.bodyHtml.includes('data-email-footer-note'))
})
