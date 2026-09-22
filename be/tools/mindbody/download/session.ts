import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { loadLogin, type StudioLogin } from './login'

/**
 * Opens Chrome with a saved Mindbody session (`auth.json`). If the session is
 * gone it signs in again by itself with the studio login (`./login.ts`), saves
 * the new session and carries on. Without a login file it waits for a person to
 * sign in in the window.
 *
 * The password is only ever typed into Mindbody's own password box: never
 * printed, logged or written anywhere else. Sign-in errors are written here, so
 * no value can ride along in a message.
 */

export const BASE = 'https://clients.mindbodyonline.com'
const LANDING = `${BASE}/app/business/reportslandingpage/FavoriteReports`
const SIGNED_IN = /clients\.mindbodyonline\.com\/(app|ASP|asp|Report)/

export class SignInError extends Error {}

export const isSignedIn = (url: string) => SIGNED_IN.test(url) && !/signin|\/launch|LoginLaunch/i.test(url)

// Page-side code runs in the browser, where these exist; declared here, not for the whole backend.
declare const document: any

async function dismissConsent(page: Page) {
  await page.evaluate(() => document.querySelectorAll('#consent_blackbar, #trustarc-banner-overlay').forEach((e: any) => e.remove())).catch(() => {})
}

/** Sign in with the saved studio login. Throws SignInError (with no secret in it) when it cannot. */
async function signIn(page: Page, login: StudioLogin, loginFile: string) {
  // 1. The studio picker. A logged-out session may land here or on the sign-in page directly.
  if (!/signin\.mindbodyonline\.com/.test(page.url())) {
    if (!/\/launch/i.test(page.url())) await page.goto(`${BASE}/launch`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await dismissConsent(page)
    const search = page.getByLabel('Mindbody site name or site ID')
    if (await search.count()) {
      await search.click({ force: true })
      await search.fill('')
      await page.keyboard.type(login.MB_STUDIO, { delay: 30 })
      await page.locator('[data-testid=search-button]').click({ force: true })
      await page.locator('[data-testid=select-studio-button]').first().waitFor({ timeout: 30_000 }).catch(() => {
        throw new SignInError('the studio search returned nothing (Mindbody may be blocking automated sign-in; try again, or sign in by hand)')
      })
    }
    // The result whose card names the studio. Exactly one, or we stop rather than guess.
    const buttons = page.locator('[data-testid=select-studio-button]')
    const cards = await buttons.evaluateAll((els: any[], name: string) => els.map(b => {
      let card = b
      for (let i = 0; i < 6 && card.parentElement && !card.innerText.toLowerCase().includes(name.toLowerCase()); i++) card = card.parentElement
      return card.innerText.toLowerCase().includes(name.toLowerCase()) as boolean
    }), login.MB_STUDIO)
    const matches = cards.flatMap((m, i) => (m ? [i] : []))
    if (matches.length === 0 && (await buttons.count()) === 1) matches.push(0) // a remembered site: one Select, no name shown
    if (matches.length !== 1) throw new SignInError(`expected one studio named MB_STUDIO in the picker, found ${matches.length}`)
    await buttons.nth(matches[0]!).click({ force: true })
    await page.waitForURL(/signin\.mindbodyonline\.com|clients\.mindbodyonline\.com\/(app|ASP)/, { timeout: 60_000 }).catch(() => {
      throw new SignInError('choosing the studio did not open the sign-in page')
    })
  }

  // 2. Email and password.
  if (/signin\.mindbodyonline\.com/.test(page.url())) {
    try {
      await page.locator('#username').waitFor({ timeout: 30_000 })
      await page.locator('#username').fill(login.MB_EMAIL)
      await page.locator('#password').fill(login.MB_PASSWORD)
      await page.getByRole('button', { name: 'Sign In' }).click()
    } catch {
      throw new SignInError('the sign-in page did not show the email and password boxes')
    }
    const outcome = await Promise.race([
      page.waitForURL(u => isSignedIn(u.href), { timeout: 60_000 }).then(() => 'in'),
      page.getByText(/incorrect|invalid|not recognized|try again|locked/i).first().waitFor({ timeout: 60_000 }).then(() => 'refused'),
      page.getByText(/verification code|two-step|2-step|authenticator|captcha|verify (it's|you are) (you|human)/i).first().waitFor({ timeout: 60_000 }).then(() => 'challenge'),
    ]).catch(() => 'timeout')
    if (outcome === 'refused') throw new SignInError(`Mindbody refused the email or password in ${path.basename(loginFile)}`)
    if (outcome === 'challenge') throw new SignInError('Mindbody asked for a verification step (code / captcha). Sign in by hand once: npm run mindbody:download -- --login-only')
    if (outcome === 'timeout' && !isSignedIn(page.url())) throw new SignInError('sign-in did not finish within a minute')
  }

  // 3. Some accounts land on a site chooser after sign-in: one Select, take it.
  if (/\/launch/i.test(page.url())) {
    const select = page.getByRole('button', { name: 'Select' }).first()
    if (await select.count()) await select.click({ force: true })
    await page.waitForURL(u => isSignedIn(u.href), { timeout: 60_000 }).catch(() => {})
  }
  if (!isSignedIn(page.url())) throw new SignInError('signed in, but did not reach the business back office')
}

export type SessionFiles = {
  /** The saved Mindbody session (cookies). Private. */
  authFile: string
  /** The studio sign-in (MB_STUDIO / MB_EMAIL / MB_PASSWORD). Private. */
  loginFile: string
}

/**
 * Make sure `page` is signed in: automatically where the login file exists,
 * else by a person in the window. Returns true when a sign-in happened.
 */
async function ensureSignedIn(page: Page, ctx: BrowserContext, files: SessionFiles): Promise<boolean> {
  if (isSignedIn(page.url())) return false
  const login = loadLogin(files.loginFile)
  if (login) {
    console.log('>> Session expired: signing in with the saved studio login...')
    await signIn(page, login, files.loginFile)
  } else {
    const select = page.getByRole('button', { name: 'Select' }).first()
    if (/\/launch/i.test(page.url()) && (await select.count())) await select.click()
    console.log(`>> No ${files.loginFile}: sign in to Mindbody in the Chrome window. Waiting up to 10 minutes...`)
    await page.waitForURL(SIGNED_IN, { timeout: 600_000 })
  }
  await page.waitForTimeout(3000)
  await ctx.storageState({ path: files.authFile })
  console.log('Signed in; session saved.')
  return true
}

export type Session = {
  browser: Browser
  ctx: BrowserContext
  page: Page
  /** Save the session's cookies. */
  save: () => Promise<void>
  /** Mid-run the session ran out: sign in again. Once per run; a second time is a SignInError. */
  relogin: () => Promise<void>
}

/** fresh: ignore the saved session and sign in from scratch (proves the automatic sign-in works). */
export async function openSession(files: SessionFiles, opts: { fresh?: boolean; downloadsPath?: string } = {}): Promise<Session> {
  // Headed, and the installed Chrome: Mindbody's studio search refuses a headless browser.
  const browser = await chromium.launch({ channel: 'chrome', headless: false, downloadsPath: opts.downloadsPath })
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 950 },
    acceptDownloads: true,
    storageState: !opts.fresh && existsSync(files.authFile) ? files.authFile : undefined,
  })
  // tsx keeps function names by wrapping them in `__name(...)`; page-side code carries that call
  // into the browser, which has no such function.
  await ctx.addInitScript({ content: 'globalThis.__name = globalThis.__name || (f => f)' })
  const page = await ctx.newPage()
  page.on('dialog', d => d.dismiss().catch(() => {}))

  await page.goto(LANDING, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  try {
    await ensureSignedIn(page, ctx, files)
  } catch (e) {
    await browser.close()
    throw e
  }
  await ctx.storageState({ path: files.authFile })
  console.log('Session ready.')

  let resigned = 0
  return {
    browser,
    ctx,
    page,
    save: async () => {
      await ctx.storageState({ path: files.authFile }).catch(() => {})
    },
    relogin: async () => {
      if (resigned++ >= 1) throw new SignInError('logged out again after signing back in once; stopping')
      await ensureSignedIn(page, ctx, files)
    },
  }
}
