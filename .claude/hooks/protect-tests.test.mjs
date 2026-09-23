import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockedTargets, isTestPath, readAllowList } from './protect-tests.mjs'

const projectDir = 'C:/repo'
const trackedTests = new Set([
  'be/src/test/booking-lifecycle.test.ts',
  'be/src/test/check-in.test.ts',
  'be/src/services/billing/refund.test.ts',
  'e2e/journeys/buy-and-book.spec.ts',
  'scripts/check-error-codes.test.mjs',
])

function check(toolName, toolInput, { allow = [], cwd = projectDir } = {}) {
  return blockedTargets({ toolName, toolInput, projectDir, cwd, trackedTests, allow }).map((t) => t.path)
}

test('test and spec files are recognised by name, other files are not', () => {
  assert.equal(isTestPath('be/src/test/check-in.test.ts'), true)
  assert.equal(isTestPath('e2e/journeys/buy-and-book.spec.ts'), true)
  assert.equal(isTestPath('scripts/check-error-codes.test.mjs'), true)
  assert.equal(isTestPath('fe-portal/src/lib/x.test.tsx'), true)
  assert.equal(isTestPath('be/src/test/harness.ts'), false)
  assert.equal(isTestPath('be/src/services/billing/refund.ts'), false)
  assert.equal(isTestPath('docs/md/testing.md'), false)
})

test('editing an existing test file is blocked, by absolute or Windows path', () => {
  assert.deepEqual(check('Edit', { file_path: 'C:\\repo\\be\\src\\test\\check-in.test.ts' }), [
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(check('Write', { file_path: 'C:/repo/e2e/journeys/buy-and-book.spec.ts' }), [
    'e2e/journeys/buy-and-book.spec.ts',
  ])
  assert.deepEqual(check('MultiEdit', { file_path: '/c/repo/be/src/services/billing/refund.test.ts' }), [
    'be/src/services/billing/refund.test.ts',
  ])
})

test('writing a new test file, or editing one not yet committed, is allowed', () => {
  assert.deepEqual(check('Write', { file_path: 'C:/repo/be/src/test/waivers.test.ts' }), [])
  assert.deepEqual(check('Edit', { file_path: 'C:/repo/be/src/test/waivers.test.ts' }), [])
})

test('editing source and harness files is allowed', () => {
  assert.deepEqual(check('Edit', { file_path: 'C:/repo/be/src/services/billing/refund.ts' }), [])
  assert.deepEqual(check('Edit', { file_path: 'C:/repo/be/src/test/harness.ts' }), [])
})

test('files outside the project are ignored', () => {
  assert.deepEqual(check('Edit', { file_path: 'C:/elsewhere/be/src/test/check-in.test.ts' }), [])
})

test('the allow list lets named test files through, by path or glob', () => {
  const file_path = 'C:/repo/be/src/test/check-in.test.ts'
  assert.deepEqual(check('Edit', { file_path }, { allow: ['be/src/test/check-in.test.ts'] }), [])
  assert.deepEqual(check('Edit', { file_path }, { allow: ['be/src/test/*.test.ts'] }), [])
  assert.deepEqual(check('Edit', { file_path }, { allow: ['**'] }), [])
  assert.deepEqual(check('Edit', { file_path }, { allow: ['be/src/services/**'] }), ['be/src/test/check-in.test.ts'])
})

test('the agent may not write the allow list itself', () => {
  assert.deepEqual(check('Write', { file_path: 'C:/repo/.claude/test-edits.allow' }), ['.claude/test-edits.allow'])
  assert.deepEqual(check('Bash', { command: 'echo "**" > .claude/test-edits.allow' }), ['.claude/test-edits.allow'])
  assert.deepEqual(check('Bash', { command: 'cat .claude/test-edits.allow' }), [])
})

test('the allow list file ignores comments and blank lines', () => {
  assert.deepEqual(readAllowList('# task #200\n\nbe/src/test/check-in.test.ts\r\n  e2e/**  \n'), [
    'be/src/test/check-in.test.ts',
    'e2e/**',
  ])
})

test('shell deletes and moves of test files are blocked', () => {
  assert.deepEqual(check('Bash', { command: 'rm be/src/test/check-in.test.ts' }), ['be/src/test/check-in.test.ts'])
  assert.deepEqual(check('Bash', { command: 'git rm -q e2e/journeys/buy-and-book.spec.ts' }), [
    'e2e/journeys/buy-and-book.spec.ts',
  ])
  assert.deepEqual(check('Bash', { command: 'mv be/src/test/check-in.test.ts /tmp/x' }), ['be/src/test/check-in.test.ts'])
  assert.deepEqual(check('Bash', { command: 'cd be && mv src/test/check-in.test.ts /tmp/x' }), [
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(check('Bash', { command: 'rm src/test/check-in.test.ts' }, { cwd: 'C:/repo/be' }), [
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(check('PowerShell', { command: 'Remove-Item -Force "be\\src\\test\\check-in.test.ts"' }), [
    'be/src/test/check-in.test.ts',
  ])
})

test('deleting a directory or glob that holds test files blocks every test in it', () => {
  assert.deepEqual(check('Bash', { command: 'rm -rf be/src/test' }), [
    'be/src/test/booking-lifecycle.test.ts',
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(check('Bash', { command: 'rm be/src/test/check-*.test.ts' }), ['be/src/test/check-in.test.ts'])
  assert.deepEqual(check('Bash', { command: "find be -name '*.test.ts' -delete" }), [
    'be/src/test/booking-lifecycle.test.ts',
    'be/src/test/check-in.test.ts',
    'be/src/services/billing/refund.test.ts',
  ])
  // GNU find with no path searches the current directory.
  assert.deepEqual(check('Bash', { command: "find -name '*.spec.ts' -delete" }), ['e2e/journeys/buy-and-book.spec.ts'])
})

test('the guardrails themselves are protected like tests', () => {
  const guarded = { trackedGuards: new Set(['.claude/settings.json', '.claude/hooks/protect-tests.mjs']) }
  const run = (toolName, toolInput, allow = []) =>
    blockedTargets({ toolName, toolInput, projectDir, cwd: projectDir, trackedTests, allow, ...guarded }).map((t) => t.path)
  assert.deepEqual(run('Edit', { file_path: 'C:/repo/.claude/hooks/protect-tests.mjs' }), ['.claude/hooks/protect-tests.mjs'])
  assert.deepEqual(run('Bash', { command: 'rm -rf .claude/hooks' }), ['.claude/hooks/protect-tests.mjs'])
  assert.deepEqual(run('Write', { file_path: 'C:/repo/.claude/settings.json' }), ['.claude/settings.json'])
  assert.deepEqual(run('Edit', { file_path: 'C:/repo/.claude/settings.json' }, ['.claude/settings.json']), [])
  assert.deepEqual(run('Write', { file_path: 'C:/repo/.claude/hooks/new-hook.mjs' }), [])
})

test('shell in-place edits and redirects onto test files are blocked', () => {
  assert.deepEqual(check('Bash', { command: "sed -i 's/it(/it.skip(/' be/src/test/check-in.test.ts" }), [
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(check('Bash', { command: 'echo "" > be/src/test/check-in.test.ts' }), ['be/src/test/check-in.test.ts'])
  assert.deepEqual(check('Bash', { command: 'cat x >>be/src/test/check-in.test.ts' }), ['be/src/test/check-in.test.ts'])
  assert.deepEqual(check('Bash', { command: 'git show HEAD~3:x | tee e2e/journeys/buy-and-book.spec.ts' }), [
    'e2e/journeys/buy-and-book.spec.ts',
  ])
  assert.deepEqual(check('Bash', { command: 'cp /tmp/weak.ts be/src/test/check-in.test.ts' }), [
    'be/src/test/check-in.test.ts',
  ])
  assert.deepEqual(
    check('Bash', { command: `node -e "require('fs').writeFileSync('be/src/test/check-in.test.ts', '')"` }),
    ['be/src/test/check-in.test.ts'],
  )
  assert.deepEqual(check('PowerShell', { command: 'Set-Content -Path e2e/journeys/buy-and-book.spec.ts -Value ""' }), [
    'e2e/journeys/buy-and-book.spec.ts',
  ])
})

test('shell commands that only read or run tests are allowed', () => {
  assert.deepEqual(check('Bash', { command: 'cat be/src/test/check-in.test.ts' }), [])
  assert.deepEqual(check('Bash', { command: 'grep -n it\\( be/src/test/check-in.test.ts > /tmp/out.txt' }), [])
  assert.deepEqual(
    check('Bash', { command: 'cd be && node --import tsx --test src/test/check-in.test.ts 2>&1 | tee /tmp/run.txt' }),
    [],
  )
  assert.deepEqual(check('Bash', { command: 'cp be/src/test/check-in.test.ts /tmp/copy.ts' }), [])
  assert.deepEqual(check('Bash', { command: 'rm -rf be/node_modules && git diff be/src/test/check-in.test.ts' }), [])
  assert.deepEqual(check('Bash', { command: "find be -name '*.log' -delete" }), [])
})

test('the allow list also lets shell commands through', () => {
  assert.deepEqual(check('Bash', { command: 'rm be/src/test/check-in.test.ts' }, { allow: ['be/src/test/check-in.test.ts'] }), [])
})
