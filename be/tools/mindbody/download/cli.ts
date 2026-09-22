/**
 * The Mindbody report download, from a terminal. Operator tooling, not the app.
 *
 *   npm run mindbody:download -- --profile cutover --dry-run   the plan: every file, view and date range; no browser
 *   npm run mindbody:download -- --profile cutover             launch day: only what the transform reads
 *   npm run mindbody:download -- [names...]                    every report ("full"), or only those whose name contains one
 *   npm run mindbody:download -- --login-only [--fresh]        sign in and save the session; download nothing
 *   npm run mindbody:download -- verify <export folder>        check a finished full download
 *   npm run mindbody:download -- inspect <file or folder> [--rows N] [--all]
 *
 * Every download writes a fresh export folder, `<root>/<YYYY-MM-DD HHmm>/`:
 *   reports/<Clients|Staff>/<NN Report>/<NN Report - view>.xls[x]
 *   _logs/_results.json, _logs/as-of.txt (when the last report landed: the config's asOf)
 * `--export <folder>` continues an earlier full download in its own folder, skipping
 * the files it already has. On a cutover folder it only fetches named reports the
 * transform does not read (e.g. `--profile cutover --export "<folder>" autopay`): the
 * folder's as-of stays, and the new results are merged into its _results.json.
 *
 * Where things are (flags win over be/.env, which wins over nothing — there is no default):
 *   --root        MB_EXPORT_ROOT   the private folder the exports go in
 *   --login-file  MB_LOGIN_FILE    the studio sign-in (MB_STUDIO / MB_EMAIL / MB_PASSWORD); default <root>/.mindbody-login.env
 *   --auth-file   MB_AUTH_FILE     the saved session;  default <root>/auth.json
 * Also: MB_START (history cutoff, YYYY-MM-DD, default 2023-01-01), MB_TIMEOUT (ms per request),
 * MB_PARALLEL (simultaneous date pieces).
 *
 * Everything it reads and writes names real people and stays in that private folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { config as loadEnv } from 'dotenv'
import {
  describePlan,
  exportDir,
  logsDir,
  pad2,
  profileReports,
  reportsDir,
  runDates,
  startDate,
  type PlannedReport,
  type Profile,
} from './plan'

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env') })

const USAGE = `usage:
  mindbody:download [--profile full|cutover] [--dry-run] [--force] [--export <folder>] [report names...]
  mindbody:download --login-only [--fresh]
  mindbody:download verify <export folder>
  mindbody:download inspect <file or folder> [--rows N] [--all]
paths: --root (MB_EXPORT_ROOT)  --login-file (MB_LOGIN_FILE)  --auth-file (MB_AUTH_FILE)`

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string', default: 'full' },
      'dry-run': { type: 'boolean', default: false },
      'login-only': { type: 'boolean', default: false },
      fresh: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      root: { type: 'string' },
      export: { type: 'string' },
      'login-file': { type: 'string' },
      'auth-file': { type: 'string' },
      rows: { type: 'string', default: '5' },
      all: { type: 'boolean', default: false },
    },
  })
  const [command, ...rest] = positionals

  if (command === 'inspect') {
    if (!rest.length) throw new Error(USAGE)
    return import('./inspect').then(m => m.inspectFiles(rest, { rows: Number(values.rows), all: values.all }))
  }

  const profile = values.profile as Profile
  if (profile !== 'full' && profile !== 'cutover') throw new Error(`--profile ${values.profile}: expected full or cutover`)
  const rootValue = values.root || process.env.MB_EXPORT_ROOT
  const root = () => {
    if (!rootValue) throw new Error(`Set MB_EXPORT_ROOT in be/.env (the private folder the exports go in), or pass --root.\n${USAGE}`)
    return path.resolve(rootValue)
  }
  const inRoot = (p: string) => (path.isAbsolute(p) ? p : rootValue ? path.resolve(root(), p) : path.resolve(p))

  if (command === 'verify') {
    if (rest.length !== 1) throw new Error(USAGE)
    return import('./verify').then(m => {
      if (m.verifyExport(inRoot(rest[0]!), profileReports(profile)) > 0) process.exitCode = 1
    })
  }

  const only = (command === undefined ? [] : positionals).map(a => a.toLowerCase())
  const reports = profileReports(profile).filter(r => !only.length || only.some(o => r.name.toLowerCase().includes(o)))
  if (only.length && !reports.length) throw new Error(`no report's name contains ${only.join(' or ')}`)
  // A cutover folder is one moment: only a named report the transform does not read may be added to it later.
  if (values.export && profile === 'cutover' && (!only.length || reports.some(r => !r.optional))) {
    throw new Error('--export: a cutover download always starts a fresh folder, so nothing older is mixed in; ' +
      'only named optional reports (not read by the transform) can be added to one')
  }

  const started = new Date()
  const dates = runDates(started, startDate())
  const folder = values.export ? inRoot(values.export) : exportDir(root(), started)

  if (values['dry-run']) {
    for (const line of describePlan(profile, folder, reports, dates)) console.log(line)
    if (profile === 'cutover') printNext(folder)
    return
  }

  const files = {
    loginFile: values['login-file'] || process.env.MB_LOGIN_FILE || path.join(root(), '.mindbody-login.env'),
    authFile: values['auth-file'] || process.env.MB_AUTH_FILE || path.join(root(), 'auth.json'),
  }
  return download({ profile, reports, folder, dates, files, loginOnly: values['login-only'], fresh: values.fresh, force: values.force,
    addOn: profile === 'cutover' && !!values.export })
}

function printNext(folder: string) {
  console.log('\nThen:\n  cd <repo>/be')
  console.log(`  npm run mindbody -- transform --export "${folder}" --config <config.json> --tenant <tenant id>`)
  console.log('  (config asOf = the finish time the run writes to _logs/as-of.txt)')
}

async function download(o: {
  profile: Profile
  reports: PlannedReport[]
  folder: string
  dates: ReturnType<typeof runDates>
  files: { loginFile: string; authFile: string }
  loginOnly: boolean
  fresh: boolean
  force: boolean
  /** Named optional reports added to a finished cutover folder. */
  addOn: boolean
}) {
  // Loaded here so the dry run needs no browser.
  const { openSession } = await import('./session')
  const { createEngine } = await import('./engine')
  let session
  try {
    session = await openSession(o.files, { fresh: o.fresh })
  } catch (e) {
    console.log(`\nSIGN-IN FAILED: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  if (o.loginOnly) {
    console.log(`Login check done: the saved session in ${o.files.authFile} is signed in.`)
    await session.browser.close()
    return
  }

  mkdirSync(reportsDir(o.folder), { recursive: true })
  console.log(`Export: ${o.folder}`)
  const engine = createEngine({
    page: session.page,
    exportDir: o.folder,
    dates: o.dates,
    relogin: session.relogin,
    save: session.save,
    force: o.force,
    timeout: Number(process.env.MB_TIMEOUT || 10 * 60_000),
    parallel: Number(process.env.MB_PARALLEL || 6),
  })
  const results: [string, string][] = []
  for (const r of o.reports) results.push(...(await engine.runReport(r)))

  const fails = results.filter(([, s]) => s.startsWith('FAIL'))
  console.log(`\nDone. ${results.length - fails.length} ok/skipped, ${fails.length} failed.`)
  for (const [b, s] of fails) console.log(`  ${b}: ${s}`)
  mkdirSync(logsDir(o.folder), { recursive: true })
  const resultsFile = path.join(logsDir(o.folder), '_results.json')
  if (o.addOn) {
    // Adding to a finished cutover folder: its results and its as-of moment stay; these replace their own lines.
    const earlier: [string, string][] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : []
    // By category and number, so an earlier line under the report's old name is replaced too.
    const key = (cat: string, folder: string) => `${cat}/${folder.slice(0, 2)}`
    const mine = new Set(o.reports.map(r => key(r.cat, pad2(r.num))))
    const merged = [...earlier.filter(([b]) => { const [cat = '', folder = ''] = b.split(/[\\/]/); return !mine.has(key(cat, folder)) }), ...results]
    writeFileSync(resultsFile, JSON.stringify(merged, null, 1))
    await session.browser.close()
    console.log(`\nAdded to ${o.folder}; its _logs/as-of.txt is unchanged.`)
    if (fails.length) process.exitCode = 1
    return
  }
  writeFileSync(resultsFile, JSON.stringify(results, null, 1))
  await session.browser.close()

  // The "as of" moment: when the last report landed, in this machine's (the studio's) offset.
  const end = new Date()
  const off = -end.getTimezoneOffset()
  const asOf = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}T${pad2(end.getHours())}:${pad2(end.getMinutes())}:00${off >= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`
  writeFileSync(path.join(logsDir(o.folder), 'as-of.txt'), `${asOf}\n`)

  if (o.profile === 'cutover') {
    const hard = fails.filter(([, s]) => !s.startsWith('FAIL (optional)'))
    if (hard.length) {
      console.log(`\nCUTOVER DOWNLOAD INCOMPLETE: ${hard.length} required report(s) failed. Do not transform; fix and re-run.`)
      process.exit(1)
    }
    console.log(`\nCutover download complete. As of ${asOf} (written to _logs/as-of.txt).`)
    printNext(o.folder)
  } else if (fails.length) {
    console.log(`\nRe-run with --export "${o.folder}" to retry only what is missing.`)
    process.exitCode = 1
  }
}

Promise.resolve()
  .then(main)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
