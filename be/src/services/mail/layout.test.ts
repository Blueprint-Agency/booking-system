import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMAIL_COLORS,
  EMAIL_LAYOUT_MARKER,
  emailButton,
  emailDetails,
  htmlToText,
  renderEmail,
  templateBodyFragment,
} from './layout'
import { SAMPLE_STUDIO, sampleEmails } from './samples'
import { TEMPLATE_VARIABLES } from '../notifications/variables'
import { frameTemplatedEmail } from '../notifications/frame'

const SAMPLES = sampleEmails()

test('every email the platform sends is sampled — each template slug and the super portal pair', () => {
  const slugs = new Set(SAMPLES.map(s => s.slug))
  for (const slug of Object.keys(TEMPLATE_VARIABLES)) assert.ok(slugs.has(slug), `${slug}: not rendered`)
  assert.ok(slugs.has('platform_two_factor_code'))
  assert.ok(slugs.has('platform_password_reset'))
})

test('every email renders through the shared layout, in the blue palette', () => {
  for (const s of SAMPLES) {
    assert.ok(s.html.includes(EMAIL_LAYOUT_MARKER), `${s.slug}: not rendered through the layout`)
    assert.ok(s.html.startsWith('<!DOCTYPE html>'), `${s.slug}: not a whole document`)
    assert.ok(s.html.includes(EMAIL_COLORS.primary), `${s.slug}: missing the brand colour`)
    assert.ok(s.html.includes('max-width:600px'), `${s.slug}: not width-capped`)
    assert.ok(s.html.includes('mso-hide:all'), `${s.slug}: no hidden preheader`)
    // The retired palette must not leak through a stored body.
    assert.ok(!/#c97a4a/i.test(s.html), `${s.slug}: still wears the old accent`)
    assert.ok(!/\{\{\w+\}\}/.test(s.html), `${s.slug}: an unrendered placeholder`)
  }
})

test('names, studio names and values are escaped in the HTML', () => {
  for (const s of SAMPLES) {
    assert.ok(!s.html.includes('<b>Studio</b>'), `${s.slug}: raw markup from the studio name`)
    assert.ok(!s.html.includes("<O'Neill>"), `${s.slug}: raw markup from a person's name`)
    if (s.audience !== 'platform') {
      assert.ok(s.html.includes('Sample &lt;b&gt;Studio&lt;/b&gt; &amp; Co'), `${s.slug}: studio name not in the header`)
    }
  }
})

test('every email has a plain-text fallback that reads as text', () => {
  for (const s of SAMPLES) {
    assert.ok(s.text.length > 80, `${s.slug}: text fallback is empty`)
    assert.ok(!/<[a-z][^>]*>/i.test(s.text.replace(/<O'Neill>|<b>|<\/b>/g, '')), `${s.slug}: markup in the text`)
    assert.ok(!/&(amp|lt|gt|quot|#\d+);/.test(s.text), `${s.slug}: entities in the text`)
    assert.ok(!/\{\{\w+\}\}/.test(s.text), `${s.slug}: an unrendered placeholder in the text`)
    if (s.audience !== 'platform') assert.ok(s.text.startsWith(SAMPLE_STUDIO), `${s.slug}: text not headed by the studio`)
  }
})

test('every link in the HTML survives into the text fallback', () => {
  for (const s of SAMPLES) {
    for (const [, href] of s.html.matchAll(/href="([^"]+)"/g)) {
      const url = href!.replace(/&amp;/g, '&')
      assert.ok(s.text.includes(url), `${s.slug}: ${url} missing from the text`)
    }
  }
})

test('the footer says why the recipient got it, per audience', () => {
  const bySlug = new Map(SAMPLES.map(s => [s.slug, s]))
  assert.match(bySlug.get('class_booking_confirmed')!.text, /you have an account with/)
  assert.match(bySlug.get('leave_approved')!.text, /you're on the .* team/)
  assert.match(bySlug.get('admin_invite')!.text, /invited this address/)
  assert.match(bySlug.get('platform_password_reset')!.text, /super portal account/)
})

test('a one-time code sits alone in its element, where the sign-in tests read it', () => {
  for (const slug of ['sign_in_code', 'staff_two_factor_code', 'platform_two_factor_code']) {
    const s = SAMPLES.find(e => e.slug === slug)!
    assert.match(s.html, />482915</, slug)
  }
})

test('the preheader skips the greeting and carries no URL', () => {
  const s = SAMPLES.find(e => e.slug === 'staff_password_reset')!
  const preheader = s.html.match(/mso-hide:all[^>]*>([^<&]*)/)![1]!
  assert.ok(preheader.length > 20)
  assert.ok(!/^Hi\b/.test(preheader), preheader)
  assert.ok(!preheader.includes('https://'), preheader)
})

test('a stored body in the retired shell is lifted out and re-dressed', () => {
  const legacy = `<!DOCTYPE html>
<html><body style="background:#f7f5f2;">
<table><tr><td>
<div style="background:#c97a4a;">SS</div><span>Second Studio</span>
</td></tr><tr><td>
<h1 style="margin:0">Your class is booked</h1>
<p style="color:#4a4742;">Hi {{client_name}},</p>
<p style="margin:24px 0;"><a href="{{qr_url}}" style="background:#c97a4a;">Show</a></p>
<hr style="border-top:1px solid #e9e4dd;" />
<p style="color:#9b9590;">Second Studio — 2 Other Road.</p>
</td></tr></table></body></html>`
  const { bodyHtml, footerNote } = templateBodyFragment(legacy)
  assert.ok(bodyHtml.startsWith('<h1'))
  assert.ok(!bodyHtml.includes('<html') && !bodyHtml.includes('SS</div>') && !bodyHtml.includes('<hr'))
  assert.ok(!bodyHtml.includes('#c97a4a') && bodyHtml.includes(EMAIL_COLORS.primary))
  assert.equal(footerNote, '2 Other Road.')

  const mailed = frameTemplatedEmail({
    slug: 'class_booking_confirmed',
    recipientKind: 'client',
    studioName: 'Second Studio',
    template: { subject: 'Booked', bodyHtml: legacy },
    variables: { client_name: 'A <b>', qr_url: 'https://x.test/q' },
  })
  assert.equal(mailed.html.split('<html').length, 2, 'wrapped exactly once')
  assert.ok(mailed.html.includes('A &lt;b&gt;'))
  assert.ok(mailed.text.includes('2 Other Road.'))
})

test('a fragment from the template editor is wrapped as it is', () => {
  const { bodyHtml, footerNote } = templateBodyFragment('<p>Hello {{client_name}},</p>')
  assert.equal(bodyHtml, '<p>Hello {{client_name}},</p>')
  assert.equal(footerNote, null)
})

test('subjects are plain text — a name with an apostrophe is not an entity', () => {
  const mailed = frameTemplatedEmail({
    slug: 'leave_approved',
    recipientKind: 'staff',
    studioName: 'S',
    template: { subject: 'For {{instructor_name}}', bodyHtml: '<p>x</p>' },
    variables: { instructor_name: "O'Neill & Co" },
  })
  assert.equal(mailed.subject, "For O'Neill & Co")
})

test('helpers: details read as "Label: value" and a button as "Label: url" in text', () => {
  const text = htmlToText(emailDetails([['Class', 'Flow']]) + emailButton('https://a.test/?x=1&amp;y=2', 'Go'))
  assert.match(text, /Class: Flow/)
  assert.match(text, /Go: https:\/\/a\.test\/\?x=1&y=2/)
  const { html } = renderEmail({ brandName: '<x>', bodyHtml: '<p>hi</p>', reason: 'r <y>' })
  assert.ok(!html.includes('<x>') && !html.includes('<y>'))
})
