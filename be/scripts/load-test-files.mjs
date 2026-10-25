/**
 * Node 22's one-process run (`--experimental-test-isolation=none`) imports the
 * files itself, and reports a file whose own code fails (a failed top-level
 * assertion, a throw, a rejected top-level `await`) only when that file had
 * registered no test yet. Once it had, the error is dropped, the tests below
 * the failure never exist, and the run passes. Here such a file fails a test
 * named after it instead, as it would in a process of its own, and the exit
 * code is set too: unlike Node's own report of such a file, a
 * `--test-name-pattern` can filter that test out. Node now sees
 * one entry file, so `t.filePath` names this file for every test.
 *
 * The `after` hook gives the event loop one more turn before the run ends. A
 * rejection nothing awaited is reported only on such a turn, and with
 * `--test-force-exit` a run of synchronous tests would otherwise exit first,
 * with code 0. A rejection that settles later than that turn is still missed.
 */
import { resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

for (const file of JSON.parse(process.env.CHECK_TEST_FILES)) {
  try {
    await import(pathToFileURL(resolve(file)).href)
  } catch (err) {
    process.exitCode = 1
    test(file, () => {
      throw err
    })
  }
}

after(() => new Promise(done => setImmediate(done)))
