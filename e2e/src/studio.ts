import { execSync } from 'node:child_process'
import type { Page } from '@playwright/test'

/**
 * The studio a run happens in, made by the backend's `e2e:studio` command
 * (be/src/e2e/studio.ts) where the database is, and read back here.
 *
 * `E2E_STUDIO_CMD` is that command up to its arguments — `setup` or
 * `teardown <slug>` is appended:
 *
 *   local:  npm --prefix ../be run -s e2e:studio --
 *   CI:     ssh deploy@bpvps2 cd /root/stacks/booking-staging '&&' \
 *             docker compose run --rm -T booking-be npm run -s e2e:studio --
 *
 * The shape is the backend's `E2eStudio`; this package shares no code with the
 * backend, so it is restated here.
 */
export type Studio = {
  slug: string
  tenantId: string
  urls: { client: string; portal: string }
  staff: {
    password: string
    admin: { email: string; name: string; role: 'admin' }
    instructor: { email: string; name: string; role: 'instructor' }
  }
  catalogue: {
    packageName: string
    packageCredits: number
    packagePriceSgd: string
    buyClassType: string
    cancelClassType: string
    portalClassType: string
  }
  classes: {
    buy: { id: string; startsAt: string }
    cancel: { id: string; startsAt: string }
  }
  members: {
    buyer: { email: string; token: string }
    canceller: { email: string; token: string }
  }
}

function studioCommand(args: string): string {
  const command = process.env.E2E_STUDIO_CMD
  if (!command) throw new Error('E2E_STUDIO_CMD is not set — see e2e/src/studio.ts')
  // stderr is the app's own logging; let it through so a failed setup explains itself.
  return execSync(`${command} ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180_000 })
}

function markedLine(output: string, marker: string): string {
  const line = output.split(/\r?\n/).find(l => l.startsWith(`${marker}=`))
  if (!line) throw new Error(`the studio command printed no ${marker} line:\n${output.slice(-2000)}`)
  return line.slice(marker.length + 1)
}

export function createStudio(): Studio {
  return JSON.parse(markedLine(studioCommand('setup'), 'E2E_STUDIO')) as Studio
}

export function removeStudio(slug: string): void {
  if (!/^e2e-[a-z0-9-]+$/.test(slug)) throw new Error(`refusing to remove ${slug}: not an e2e studio`)
  markedLine(studioCommand(`teardown ${slug}`), 'E2E_REMOVED')
}

/** The studio global setup made, handed to the journeys through the environment. */
export function studio(): Studio {
  const raw = process.env.E2E_STUDIO
  if (!raw) throw new Error('no studio: global setup did not run')
  return JSON.parse(raw) as Studio
}

/**
 * Sign a member in the way the member app itself would find them signed in: a
 * session token in this hostname's own storage (fe-client/src/lib/member-auth.ts).
 * Signing in by emailed code is not one of the journeys; the token is a real
 * session the backend opened for them.
 */
export async function signInMember(page: Page, member: { token: string }): Promise<void> {
  const { client } = studio().urls
  await page.addInitScript(
    ([origin, token]) => {
      if (window.location.origin === origin) window.localStorage.setItem('rt.client.session', token)
    },
    [client, member.token] as const,
  )
}

/** Sign a staff member in through the portal's own form. */
export async function signInStaff(page: Page, person: { email: string }): Promise<void> {
  const { urls, staff } = studio()
  await page.goto(`${urls.portal}/login`)
  await page.getByLabel('Email').fill(person.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(staff.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
