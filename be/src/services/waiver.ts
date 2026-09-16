/**
 * Daily cron: surface clients whose waiver signature is older than the current
 * waiver.updated_at (i.e. they signed an older version of the text). v1 just
 * logs; admin reset flow re-signs them.
 */
export async function flagExpiredWaivers(): Promise<void> {
  // TODO: SELECT clients JOIN waiver_signatures WHERE signed_at < waiver.updated_at
}
