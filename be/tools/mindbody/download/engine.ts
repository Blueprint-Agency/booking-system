import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Download, Page } from 'playwright-core'
import { dmy, jobBase, manifestPattern, pad2, reportPrefix, reportsDir, resolveTokens, ymd, type PlannedReport, type RunDates } from './plan'
import type { FieldSet, Report, ReportOverride, StepName } from './reports'
import { BASE } from './session'
import { writeXlsx } from './xlsx-write'

/**
 * The browser half of the download: one runner per kind of Mindbody page, and
 * the date splitting that works around Mindbody refusing or silently capping a
 * large range. What to fetch and what to call it is decided in `./plan.ts`.
 */

// Page-side code runs in the browser, where these exist; declared here, not for the whole backend.
declare const document: any
declare const window: any
declare const location: any
declare const Event: any
declare const FormData: any

/** "Too many" = refused outright. CAPPED = silently cut short (e.g. a detail list that stops at 500 rows). */
const TOO_MANY = /too many results/i
const CAPPED = /only the first [\d,]+ .{0,40}have been listed|not all results have been listed/i
class TooManyError extends Error {}

type Job = Report & ReportOverride & { single?: boolean; file?: string }

export type EngineOptions = {
  page: Page
  /** The export folder; reports go under `reports/`, the run's log under `_logs/`. */
  exportDir: string
  dates: RunDates
  relogin: () => Promise<void>
  save: () => Promise<void>
  force: boolean
  /** Per request: MB_TIMEOUT ms, default 10 minutes. */
  timeout: number
  /** Simultaneous date-piece requests: MB_PARALLEL, default 6. */
  parallel: number
}

export function createEngine(o: EngineOptions) {
  const { page, dates } = o
  const OUT = reportsDir(o.exportDir)
  const END_OF = { $TODAY: dates.today, $FUTURE1Y: dates.future1y, $FUTURE: dates.future } as const

  /** base = "<Clients|Staff>/<NN Report>/<NN Report - variant>" (relative to OUT, no extension). */
  const existing = (base: string) => {
    const dir = path.join(OUT, path.dirname(base))
    if (!existsSync(dir)) return null
    const name = `${path.basename(base)}.`
    return readdirSync(dir).find(f => f.startsWith(name) && !f.endsWith('.FAILED.png')) ?? null
  }

  async function load(p: string): Promise<void> {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    if (!/clients\.mindbodyonline\.com/.test(page.url()) || /signin|\/launch/i.test(page.url())) {
      console.log('>> Logged out mid-run.')
      await o.relogin()
      return load(p)
    }
    await page.waitForTimeout(1500)
  }

  /**
   * Set form fields by name (falls back to id). Returns what was not found.
   * quiet: fire no change events (old pages auto-submit on some dropdown changes).
   */
  function setFields(set: FieldSet, allMulti?: boolean, quiet?: boolean): Promise<string[]> {
    return page.evaluate(({ set, allMulti, quiet }) => {
      const fire = (el: any) => quiet || ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })))
      const missing: string[] = []
      if (allMulti) {
        document.querySelectorAll('select[multiple]').forEach((s: any) => { [...s.options].forEach((o: any) => (o.selected = true)); fire(s) })
        document.querySelectorAll('input[type=checkbox][id^="ddcl-"]').forEach((c: any) => { c.checked = true })
        if (window.jQuery) try { window.jQuery('select[multiple]').dropdownchecklist && window.jQuery('select[multiple]').dropdownchecklist('refresh') } catch {}
      }
      for (const [name, val] of Object.entries(set)) {
        let els: any[] = [...document.getElementsByName(name)]
        if (!els.length && document.getElementById(name)) els = [document.getElementById(name)]
        if (!els.length) { missing.push(name); continue }
        const el = els[0]
        if (el.tagName === 'SELECT') {
          if (![...el.options].some((o: any) => o.value === String(val))) { missing.push(`${name}=${val} (no such option)`); continue }
          if (el.multiple) [...el.options].forEach((o: any) => (o.selected = o.value === String(val)))
          else el.value = String(val)
          fire(el)
        } else if (el.type === 'radio') {
          const r = els.find(e => e.value === String(val))
          if (!r) { missing.push(`${name}=${val}`); continue }
          r.checked = true; fire(r)
        } else if (el.type === 'checkbox') {
          const cb = els.find(e => e.type === 'checkbox')
          if (cb.checked !== !!val) { cb.checked = !!val; fire(cb) }
          els.filter(e => e.type === 'hidden').forEach(h => (h.value = String(!!val)))
        } else {
          el.value = String(val); fire(el)
        }
      }
      return missing
    }, { set, allMulti: !!allMulti, quiet: !!quiet })
  }

  async function saveDownload(dl: Download, base: string): Promise<string> {
    const ext = path.extname(dl.suggestedFilename()) || '.xls'
    const file = path.join(OUT, base + ext)
    await dl.saveAs(file)
    const err = await dl.failure()
    if (err) throw new Error(`download failed: ${err}`)
    return file
  }

  function writeEmpty(base: string): string {
    const file = path.join(OUT, `${base}.EMPTY.txt`)
    writeFileSync(file, 'Mindbody returned no rows for this report with everything selected.\n')
    return file
  }

  /* ── One runner per kind of page ─────────────────────────────────────── */

  // Old ASP pages: exportReport() just sets frmGenReport/frmExpReport=true and submits the form.
  // So: fill the form once (cached per filter set), then POST it directly for each date piece.
  const legacyForms = new Map<string, { action: string; entries: [string, string][] }>()
  const isDateKey = (k: string) => /date|Start$|End$/i.test(k)

  async function runLegacy(r: Job, set: FieldSet, base: string): Promise<string> {
    const key = r.path + JSON.stringify(Object.entries(set).filter(([k]) => !isDateKey(k)))
    let form = legacyForms.get(key)
    if (!form) {
      await load(r.path)
      const missing = await setFields(set, false, true)
      if (missing.length) console.log(`   (not on page: ${missing.join(', ')})`)
      const found: { action: string; entries: [string, string][] } | { debug: string } = await page.evaluate(() => {
        // The export form is usually frmParameter, but not always (Big Spenders: frmSales).
        const f = document.querySelector('[name=frmExpReport]')?.form
        if (!f || typeof window.exportReport !== 'function') {
          return { debug: `${[...document.forms].map((x: any) => x.name || x.id).join(',')} fn=${typeof window.exportReport} url=${location.pathname}` }
        }
        return { action: new URL(f.getAttribute('action') || location.pathname, location.href).href, entries: [...new FormData(f).entries()] as [string, string][] }
      })
      if ('debug' in found) throw new Error(`no frmParameter/exportReport() on page: ${found.debug}`)
      form = found
      legacyForms.set(key, form)
    }
    const body = new URLSearchParams()
    for (const [k, v] of form.entries) body.append(k, k in set && isDateKey(k) ? String(set[k]) : v)
    body.set('frmGenReport', 'true')
    body.set('frmExpReport', 'true')
    const res = await page.request.post(form.action, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: body.toString(), timeout: o.timeout,
    })
    if (res.status() >= 500) throw new TooManyError(`server error ${res.status()}`)
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
    if (/signin|\/launch/i.test(res.url())) { legacyForms.clear(); await load(r.path); return runLegacy(r, set, base) }
    const file = path.join(OUT, `${base}.xls`)
    writeFileSync(file, await res.body())
    return file
  }

  async function runMvc(r: Job, set: FieldSet, base: string): Promise<string> {
    await load(r.path)
    const missing = await setFields(set, r.allMulti)
    if (missing.length) console.log(`   (not on page: ${missing.join(', ')})`)
    await page.waitForLoadState('networkidle', { timeout: o.timeout }).catch(() => {})
    if (!(await page.locator('#excel-button').count())) throw new TooManyError('report page errored (range too big?)')
    // No Go! needed: Export posts the form itself. It first asks /isdata; with no rows the page
    // shows "Nothing matches" and never downloads.
    const nothing = page.getByText('Nothing matches that search').first()
    const dlP = page.waitForEvent('download', { timeout: o.timeout })
    await page.locator('#excel-button').click()
    const winner = await Promise.race([
      dlP,
      nothing.waitFor({ state: 'visible', timeout: o.timeout }).then(() => 'nodata' as const),
      page.getByText(TOO_MANY).first().waitFor({ state: 'visible', timeout: o.timeout }).then(() => 'toomany' as const),
      // A download aborts the navigation (ERR_ABORTED) -> ignore that, keep waiting for the download.
      page.waitForURL(u => !u.pathname.toLowerCase().startsWith(r.path.toLowerCase()), { timeout: o.timeout })
        .then(() => 'navigated' as const, () => new Promise<never>(() => {})),
    ])
    if (winner === 'nodata') { dlP.catch(() => {}); return writeEmpty(base) }
    if (winner === 'toomany' || winner === 'navigated') { dlP.catch(() => {}); throw new TooManyError(winner) }
    return saveDownload(winner, base)
  }

  async function runScrape(r: Job, set: FieldSet, base: string): Promise<string> {
    await load(r.path)
    if (r.set) {
      await setFields(set)
      if (r.submit) await Promise.all([page.waitForLoadState('load'), page.evaluate(() => document.forms[document.forms.length - 1]?.submit())]).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: o.timeout }).catch(() => {})
      await page.waitForTimeout(2000)
    }
    // Old pages wrap data tables in layout tables: keep innermost tables only.
    const tables: string[][][] = await page.evaluate(() =>
      [...document.querySelectorAll('#main-content table, body table')]
        .filter((t: any, i: number, all: any[]) => all.indexOf(t) === i && !t.querySelector('table') && t.rows.length > 1)
        .map((t: any) => [...t.rows].map((tr: any) => [...tr.cells].map((td: any) => String(td.innerText).trim().replace(/\s+/g, ' ')))))
    if (!tables.length) throw new Error('no tables found to scrape')
    const rows: string[][] = []
    for (const t of tables) rows.push(...t, [])
    const file = path.join(OUT, `${base}.xlsx`)
    writeFileSync(file, await writeXlsx(rows, r.name))
    return file
  }

  async function runReact(r: Job, _set: FieldSet, base: string): Promise<string> {
    await load(r.path)
    await page.waitForTimeout(3000)
    const us = (d: Date) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`
    const boxes = page.locator('input[placeholder*="MM"], input[value*="/20"]')
    await boxes.nth(0).click(); await page.keyboard.press('Control+a')
    await page.keyboard.type(us(dates.start))
    await boxes.nth(1).click(); await page.keyboard.press('Control+a')
    await page.keyboard.type(us(dates.today))
    // The location dropdown -> "All locations". It shows a studio's own location name, so find it by its options.
    const combos = page.locator('[role=combobox]')
    for (let i = 0, n = Math.min(await combos.count(), 6); i < n; i++) {
      await combos.nth(i).click().catch(() => {})
      const all = page.getByRole('option', { name: /^All locations?$/i }).first()
      if (await all.count()) {
        await all.click()
        await page.keyboard.press('Escape') // the multi-select menu stays open and blocks clicks
        await page.waitForTimeout(500)
        break
      }
      await page.keyboard.press('Escape')
    }
    const inactive = page.getByLabel(/Include inactive staff/i)
    if (await inactive.count()) await inactive.check()
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    const excel = page.getByRole('button', { name: 'Export to Excel' }).first()
    await excel.waitFor({ timeout: o.timeout })
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: o.timeout }), excel.click()])
    return saveDownload(dl, base)
  }

  // New-style "requested" reports (e.g. Membership New Version): Export to Excel queues a job; the file
  // appears later in the page's Requested Reports table. Poll that table and download the new row.
  async function runRequested(r: Job, _set: FieldSet, base: string): Promise<string> {
    const rows = () => page.getByRole('row').filter({ hasText: r.requestedName ?? '' })
    await load(r.path)
    await page.waitForTimeout(3000)
    const before = await rows().count()
    for (const label of r.check ?? []) await page.getByLabel(label, { exact: true }).check()
    await page.getByRole('button', { name: 'Export to Excel' }).first().click()
    const t0 = Date.now()
    while (Date.now() - t0 < o.timeout) {
      await page.waitForTimeout(15_000)
      await load(r.path)
      await page.waitForTimeout(3000)
      if ((await rows().count()) <= before) continue
      const icon = rows().first().locator('a, button, [role=button], svg, img').last() // newest first
      try {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), icon.click()])
        return await saveDownload(dl, base)
      } catch { /* still building: no download link yet */ }
    }
    throw new Error('requested report never became downloadable')
  }

  async function runHealth(r: Job, _set: FieldSet, base: string): Promise<string> {
    await load(r.path)
    await page.waitForTimeout(3000)
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: o.timeout }), page.locator('#btn_Memberhealth').click()])
    return saveDownload(dl, base)
  }

  /** Every option of the named selects, read from the page's HTML without rendering it (some pages freeze the browser). */
  async function selectOptions(p: string, names: string[]): Promise<Record<string, string[]>> {
    const res = await page.request.get(BASE + p, { timeout: o.timeout })
    const html = res.ok() ? await res.text() : ''
    const found: Record<string, string[]> = {}
    for (const n of names) {
      const m = new RegExp(`<select[^>]*\\bname=["']?${n}["']?[^>]*>([\\s\\S]*?)</select>`, 'i').exec(html)
      const values = m ? [...m[1]!.matchAll(/<option[^>]*\bvalue=["']?([^"'>\s]*)/gi)].map(x => x[1]!) : []
      if (values.length) found[n] = values
    }
    if (Object.keys(found).length === names.length) return found
    // Built by script: render the page after all.
    await load(p)
    return page.evaluate((names: string[]) =>
      Object.fromEntries(names.map(n => [n, [...(document.getElementsByName(n)[0]?.options ?? [])].map((o: any) => String(o.value))])), names)
  }

  // Pages that freeze the browser when rendered: POST the Excel endpoint directly (same session cookies).
  // An array value is a repeated field (optSaleLoc=0&optSaleLoc=2...); '*' is every option of that select.
  async function runPost(r: Job, set: FieldSet, base: string): Promise<string> {
    const stars = Object.keys(set).filter(k => set[k] === '*')
    if (stars.length) set = { ...set, ...(await selectOptions(r.path, stars)) }
    const body = new URLSearchParams({ hPostAction: 'Excel', autogenerate: 'hasGenerated', reportUrl: r.path })
    for (const [k, v] of Object.entries(set)) for (const one of ([] as (string | boolean)[]).concat(v)) body.append(k, String(one))
    const res = await page.request.post(`${BASE}${r.path}/Excel`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: body.toString(), timeout: o.timeout,
    })
    const type = res.headers()['content-type'] ?? ''
    const buf = await res.body()
    if (!res.ok() || /text\/html/.test(type)) {
      const text = buf.toString('utf8')
      // Big ranges crash the server and redirect to /Error -> split the dates.
      if (TOO_MANY.test(text) || res.status() >= 500 || /\/Error\b/i.test(res.url())) throw new TooManyError(`HTTP ${res.status()}`)
      // No rows: the server answers with the report page itself instead of a file.
      if (res.status() === 200 && new URL(res.url()).pathname.toLowerCase().startsWith(r.path.toLowerCase())) return writeEmpty(base)
      writeFileSync(path.join(OUT, `${base}.FAILED.html`), text)
      const title = (/<title>([^<]*)/i.exec(text) ?? [])[1] ?? ''
      throw new Error(`HTTP ${res.status()} ${type} ${title.trim()} (${res.url().replace(BASE, '').split('?')[0]})`)
    }
    const file = path.join(OUT, base + (/sheet/.test(type) ? '.xlsx' : '.xls'))
    writeFileSync(file, buf)
    return file
  }

  const RUNNERS = { legacy: runLegacy, mvc: runMvc, scrape: runScrape, react: runReact, health: runHealth, post: runPost, requested: runRequested }

  /* ── Date splitting ──────────────────────────────────────────────────── */

  // Mindbody refuses big ranges ("too many results") or silently caps them ("only the first 500 ...
  // have been listed"). Either way: re-run in smaller date pieces, one file per piece:
  // year -> quarter -> month -> week -> day. A report can start at a smaller step with `split`.
  const STEPS: { name: StepName; next: (s: Date) => Date; label: (s: Date) => string }[] = [
    { name: 'year', next: s => new Date(s.getFullYear() + 1, 0, 1), label: s => `${s.getFullYear()}` },
    { name: 'quarter', next: s => new Date(s.getFullYear(), Math.floor(s.getMonth() / 3) * 3 + 3, 1), label: s => `${s.getFullYear()}-Q${Math.floor(s.getMonth() / 3) + 1}` },
    { name: 'month', next: s => new Date(s.getFullYear(), s.getMonth() + 1, 1), label: s => `${s.getFullYear()}-${pad2(s.getMonth() + 1)}` },
    { name: 'week', next: s => { const n = new Date(s); n.setDate(n.getDate() + 7 - ((n.getDay() + 6) % 7)); return n }, label: s => `${ymd(s)} wk` },
    { name: 'day', next: s => new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1), label: s => ymd(s) },
  ]

  function fileProblem(file: string): string | null {
    if (!/\.(xls|html?)$/i.test(file)) return null
    const text = readFileSync(file, 'utf8')
    if (TOO_MANY.test(text)) return 'too many results'
    const capped = CAPPED.exec(text)
    return capped ? `capped: ${capped[0].replace(/&nbsp;/g, ' ')}` : null
  }

  type Window = { from: Date; to: Date }

  async function runSplitting(r: Job, rawSet: FieldSet, base: string, win: Window | null, level = -1, rootBase = base): Promise<string[]> {
    const set = resolveTokens(rawSet, dates)
    if (win) for (const [k, v] of Object.entries(rawSet)) {
      if (v === '$START') set[k] = dmy(win.from)
      if (typeof v === 'string' && v in END_OF && /end/i.test(k)) set[k] = dmy(win.to)
    }
    const hasDates = Object.values(rawSet).includes('$START')
    const startLevel = r.split ? STEPS.findIndex(s => s.name === r.split) : -1
    let problem: string | null = null
    if (!hasDates || level >= startLevel) {
      let file: string | null = null
      try {
        file = await RUNNERS[r.type](r, set, base)
      } catch (e) {
        if (!(e instanceof TooManyError) || !hasDates) throw e
        problem = e.message
      }
      if (file) {
        problem = fileProblem(file)
        // Read by the transform as one file: a capped one would be a studio silently missing rows.
        if (problem && r.single) throw new Error(`${problem} — this report must come back whole; check Mindbody and re-run`)
        if (!problem || !hasDates) {
          if (problem) console.log(`   WARNING ${path.basename(file)}: ${problem}`)
          return [file]
        }
        unlinkSync(file)
      }
    }
    const step = STEPS[Math.max(level + 1, startLevel)]
    if (!step) throw new Error(`still ${problem} for a 1-day range`)
    if (r.single) throw new Error(`${problem} — the transform reads this report as one file, so it cannot be split`)
    if (problem && level + 1 >= startLevel) console.log(`   ${problem} -> ${step.name} pieces`)
    const from = win ? win.from : dates.start
    const endToken = Object.entries(rawSet).find(([k, v]) => /end/i.test(k) && typeof v === 'string' && v in END_OF)?.[1] as keyof typeof END_OF | undefined
    const to = win ? win.to : endToken ? END_OF[endToken] : dates.today
    const pieces: { pieceBase: string; win: Window }[] = []
    for (let s = new Date(from); s <= to;) {
      const n = step.next(s)
      const e = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1)
      const pieceBase = `${rootBase} - ${step.label(s)}`
      if (o.force || !existing(pieceBase)) pieces.push({ pieceBase, win: { from: s, to: e > to ? to : e } })
      s = n
    }
    // Request-based types don't touch the page per piece -> fetch several pieces at once.
    const parallel = r.type === 'legacy' || r.type === 'post' ? o.parallel : 1
    const runPiece = (p: (typeof pieces)[number]) => runSplitting(r, rawSet, p.pieceBase, p.win, STEPS.indexOf(step), rootBase)
    const out: string[] = []
    // First piece alone: it loads the page once and caches the filled-in form for the rest.
    let i = 0
    if (pieces.length) { out.push(...(await runPiece(pieces[0]!))); i = 1 }
    for (; i < pieces.length; i += parallel) {
      for (const files of await Promise.all(pieces.slice(i, i + parallel).map(runPiece))) out.push(...files)
      if (pieces.length > 50 && Math.floor(i / parallel) % 20 === 0) console.log(`   ${Math.min(i + parallel, pieces.length)}/${pieces.length} ${step.name} pieces`)
    }
    return out
  }

  /* ── One report ──────────────────────────────────────────────────────── */

  type Result = [string, string]

  /** Download every file of one report. Returns one result line per job. */
  async function runReport(r: PlannedReport): Promise<Result[]> {
    const prefix = reportPrefix(r)
    const results: Result[] = []
    // Expand per-option loops x variants into jobs. A variant may override report props (type, path...).
    let loops: { label: string; set: FieldSet }[] = [{ label: '', set: {} }]
    if (r.loopSelect) {
      await load(r.path)
      const opts: [string, string][] = await page.evaluate((n: string) =>
        [...(document.getElementsByName(n)[0]?.options ?? [])].map((o: any) => [String(o.value), String(o.text).replace(/\s+/g, ' ').trim()] as [string, string]), r.loopSelect)
      const kept = opts.filter(([v, t]) => !(r.loopSkip ?? []).includes(v) && (!r.loopOnly || r.loopOnly.test(v)) && (!r.loop || r.loop.match.test(t)))
      if (r.loop) {
        if (kept.length !== 1) return [[prefix, `FAIL expected one "${r.loopSelect}" option matching ${r.loop.match}, found ${kept.length}`]]
        // Written under the profile's own label, so the name is the one the transform expects.
        loops = [{ label: r.loop.label, set: { [r.loopSelect]: kept[0]![0] } }]
      } else {
        const seen: Record<string, number> = {}
        loops = kept.map(([v, t]) => {
          seen[t] = (seen[t] ?? 0) + 1
          return { label: seen[t]! > 1 ? `${t} (${seen[t]})` : t, set: { [r.loopSelect!]: v } }
        })
      }
    }
    const jobs: { labels: string[]; set: FieldSet; r: Job }[] = []
    for (const l of loops) for (const { label = '', set: vset = {}, ...override } of r.variants ?? [{ label: '' }]) {
      jobs.push({ labels: [l.label, label], set: { ...r.set, ...l.set, ...vset }, r: { ...r, ...override } })
    }

    for (const job of jobs) {
      // One folder per report, inside Clients/ or Staff/.
      const base = path.join(r.cat, prefix, jobBase(r, job.labels))
      mkdirSync(path.join(OUT, path.dirname(base)), { recursive: true })
      if (!o.force && existing(base)) { console.log(`skip  ${base}`); results.push([base, 'skipped']); continue }
      const t0 = Date.now()
      console.log(`...   ${base}`)
      try {
        const files = await runSplitting(job.r, job.set, base, null)
        // Named as the transform expects, or it would be read as nothing (or as the wrong report).
        if (r.file) {
          const pattern = manifestPattern(r.file)
          const odd = files.filter(f => !/\.EMPTY\.txt$/.test(f) && !pattern.test(path.basename(f)))
          if (odd.length) throw new Error(`wrote ${odd.map(f => path.basename(f)).join(', ')}, not the expected ${r.file}`)
        }
        for (const file of files) {
          console.log(`OK    ${path.basename(file)}  ${Math.round(statSync(file).size / 1024)} KB  ${Math.round((Date.now() - t0) / 1000)}s`)
        }
        results.push([base, `ok${files.length > 1 ? ` (${files.length} date pieces)` : ''}`])
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).split('\n')[0]
        console.log(`FAIL  ${base}: ${message}`)
        await page.screenshot({ path: path.join(OUT, `${base}.FAILED.png`) }).catch(() => {})
        results.push([base, `${r.optional ? 'FAIL (optional)' : 'FAIL'} ${message}`])
      }
      await o.save()
    }
    return results
  }

  return { runReport }
}
