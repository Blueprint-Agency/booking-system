import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

/**
 * Fails the run when any journey is skipped — as a skipped backend test already
 * fails the backend job. A skip is a passing test that tested nothing, and the
 * quiet way for an agent (or a tired human) to hide a broken feature.
 *
 * Catches both kinds: `test.skip(…)` / `test.fixme(…)` / `describe.skip` are
 * known before anything runs (so `playwright test --list` fails on them too),
 * and a `test.skip()` inside a journey shows up when it ends. A journey skipped
 * only because an earlier serial one failed carries no skip annotation, and is
 * left to that failure to report.
 */
export default class NoSkipsReporter implements Reporter {
  private readonly skipped = new Map<string, TestCase>()

  onBegin(_config: unknown, suite: Suite) {
    for (const test of suite.allTests()) {
      if (test.expectedStatus === 'skipped') this.skipped.set(test.id, test)
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const deliberate = [...test.annotations, ...result.annotations].some((a) => a.type === 'skip' || a.type === 'fixme')
    if (result.status === 'skipped' && deliberate) this.skipped.set(test.id, test)
  }

  async onEnd(result: FullResult) {
    if (this.skipped.size === 0) return
    const lines = [...this.skipped.values()].map(
      (t) => `  - ${t.titlePath().filter(Boolean).join(' › ')} (${t.location.file}:${t.location.line})`,
    )
    console.error(
      [
        `\n${this.skipped.size} journey(s) skipped — a skipped journey fails the run:`,
        ...lines,
        'Fix the feature or the journey. A journey that is genuinely broken is a bug to file, not a test to skip.',
      ].join('\n'),
    )
    return { status: result.status === 'interrupted' ? result.status : ('failed' as const) }
  }

  printsToStdio() {
    return false
  }
}
