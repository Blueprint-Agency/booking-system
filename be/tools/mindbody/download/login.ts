import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The studio's Mindbody sign-in, read from a private file outside the repo
 * (`MB_LOGIN_FILE`, default `<export root>/.mindbody-login.env`).
 * KEY=value lines; `#` comments and blank lines ignored; surrounding quotes stripped.
 *
 * Nothing here ever prints a value: callers get the values, messages name keys at most.
 */

export type StudioLogin = { MB_STUDIO: string; MB_EMAIL: string; MB_PASSWORD: string }

const KEYS = ['MB_STUDIO', 'MB_EMAIL', 'MB_PASSWORD'] as const

/** The login, or null when the file does not exist (a person then signs in by hand). */
export function loadLogin(file: string): StudioLogin | null {
  if (!existsSync(file)) return null
  const out: Record<string, string> = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, eq).trim()] = v
  }
  const missing = KEYS.filter(k => !out[k])
  if (missing.length) throw new Error(`${path.basename(file)} is missing ${missing.join(', ')}`)
  return { MB_STUDIO: out.MB_STUDIO!, MB_EMAIL: out.MB_EMAIL!, MB_PASSWORD: out.MB_PASSWORD! }
}
