/**
 * The e2e studio writes a studio and people into whatever database it is
 * pointed at, and its teardown deletes rows. Production holds real studios and
 * nothing about a real studio is ever a fixture, so it refuses there outright —
 * staging is where the journeys run (#145).
 *
 * Its own file, with no imports, so the refusal is checked before `src/env.ts`
 * or a database connection is loaded.
 */
export function assertMayRunE2eStudio(appEnv: string | undefined): void {
  if (appEnv === 'production') {
    throw new Error('the e2e studio never runs on production (APP_ENV=production)')
  }
}
