import { after, before } from 'node:test'

/**
 * Set environment values for the `describe` this is called in, and put back
 * what was there when it ends.
 *
 * Call it first in the `describe`, so the values are in place before the
 * file's own `before` runs. Never at a file's top level: every backend test
 * file runs in one process (`docs/md/testing.md` § Running the backend tests),
 * where a top-level write would hold for every other file too. That is also
 * why the app reads these values when it uses them rather than when it loads
 * (`currentEnv` in `src/env.ts`).
 */
export function withEnv(values: Record<string, string>): void {
  const was = new Map<string, string | undefined>()
  before(() => {
    for (const [name, value] of Object.entries(values)) {
      was.set(name, process.env[name])
      process.env[name] = value
    }
  })
  after(() => {
    for (const [name, value] of was) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}
