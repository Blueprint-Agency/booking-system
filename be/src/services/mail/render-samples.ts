/**
 * Write every email the platform sends to a folder, as `.html` and `.txt`, with
 * an `index.html` linking them — for a human to eyeball the design.
 *
 *   npx tsx src/services/mail/render-samples.ts [outDir]
 *
 * `outDir` defaults to `email-samples` in the OS temp directory; nothing is
 * written inside the repo. Needs no env, database or mail key.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { escapeHtml } from './layout'
import { sampleEmails } from './samples'

const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'email-samples'))
mkdirSync(outDir, { recursive: true })

const samples = sampleEmails()
for (const s of samples) {
  writeFileSync(join(outDir, `${s.slug}.html`), s.html)
  writeFileSync(join(outDir, `${s.slug}.txt`), `Subject: ${s.subject}\n\n${s.text}\n`)
}

const rows = samples
  .map(
    s =>
      `<tr><td>${s.audience}</td><td><a href="${s.slug}.html">${s.slug}</a> · <a href="${s.slug}.txt">text</a></td><td>${escapeHtml(s.subject)}</td></tr>`,
  )
  .join('\n')
writeFileSync(
  join(outDir, 'index.html'),
  `<!DOCTYPE html><meta charset="utf-8"><title>Email samples</title>
<body style="font-family:system-ui,sans-serif;padding:24px;">
<h1>Email samples (${samples.length})</h1>
<table cellpadding="6" style="border-collapse:collapse;">${rows}</table>
</body>`,
)

console.log(`wrote ${samples.length} emails to ${outDir}`)
