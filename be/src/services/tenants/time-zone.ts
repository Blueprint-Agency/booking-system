import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { BadRequestError } from '../../shared/errors'

/**
 * Link names that V8's `Intl.supportedValuesOf('timeZone')` still lists, mapped
 * to the name the tz database now gives the same zone. Debian's Postgres, which
 * CI and the compose stack run, does not know the old spellings; Alpine's does.
 * A studio is always stored under the current name, so it works on both.
 * fe-portal keeps the same table (`lib/studio-time-zones.ts`): the two share no
 * code.
 */
export const CURRENT_ZONE_NAME: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
}

/** Every spelling we know, by lower case, so `asia/singapore` finds `Asia/Singapore`. */
let spellings: Map<string, string> | null = null
function spellingOf(lowerCased: string): string | undefined {
  if (!spellings) {
    spellings = new Map()
    const known = [
      ...Intl.supportedValuesOf('timeZone'),
      ...Object.keys(CURRENT_ZONE_NAME),
      ...Object.values(CURRENT_ZONE_NAME),
      'UTC',
    ]
    for (const name of known) spellings.set(name.toLowerCase(), name)
  }
  return spellings.get(lowerCased)
}

/** The same zone under the name the tz database gives it today. */
export function currentZoneName(name: string): string {
  return CURRENT_ZONE_NAME[name] ?? name
}

/**
 * The IANA zone a studio is created on, or a 400 saying why not.
 *
 * A studio's zone is fixed at creation and decides when its jobs fire and
 * what its days are, so the super portal's create route takes none on trust:
 * a request that names no zone is `timezone_required` (no studio ever lands on
 * another's clock by omission), and anything else that is not a zone is
 * `timezone_invalid`.
 *
 * Only an Area/Location name or exactly `UTC` is a zone here. `Intl` also
 * accepts a fixed offset (`+08:00`) and the old three-letter ids (`AET`, `IST`,
 * `PST`): Postgres refuses some of those and reads others as a different
 * offset, which would break the platform-wide sweep that ends Terms. A name
 * that gets through is also checked against the database's own list
 * (`pg_timezone_names`), so a zone this process can read and the database
 * cannot never reaches a row.
 *
 * What is stored is the zone list's own spelling under its current name:
 * `asia/singapore` becomes `Asia/Singapore` and `Asia/Calcutta` becomes
 * `Asia/Kolkata`.
 */
export async function requireStudioTimeZone(raw: unknown): Promise<string> {
  if (raw === undefined || raw === null) throw new BadRequestError('timezone_required')
  if (typeof raw !== 'string') throw new BadRequestError('timezone_invalid')
  const typed = raw.trim()
  if (!typed) throw new BadRequestError('timezone_required')

  const lowerCased = typed.toLowerCase()
  if (lowerCased !== 'utc' && !typed.includes('/')) throw new BadRequestError('timezone_invalid')
  const name = currentZoneName(spellingOf(lowerCased) ?? typed)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
  } catch {
    throw new BadRequestError('timezone_invalid')
  }
  const listed = await db.execute(sql`select 1 from pg_timezone_names where name = ${name}`)
  if (listed.length === 0) throw new BadRequestError('timezone_invalid')
  return name
}
