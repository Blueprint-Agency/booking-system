#!/usr/bin/env node
/**
 * PreToolUse hook: an agent may not edit, overwrite, move or delete a test file
 * that is already committed. Tests verify behaviour; the easiest way to turn a
 * red suite green is to weaken the test, and this is the fence against that.
 *
 * New test files, and ones not yet committed, are free to write. A committed
 * one is let through only when a human names it in `.claude/test-edits.allow`
 * (one path or glob per line, relative to the repo root; gitignored), or when
 * the session was started with ALLOW_TEST_EDITS=1. The agent may not write the
 * allow list itself, and the committed hooks and `.claude/settings.json` are
 * protected like tests — otherwise the fence could simply be taken down.
 *
 * Covers Edit / Write / MultiEdit / NotebookEdit exactly, and Bash / PowerShell
 * by reading the command for deletes, moves, in-place edits, copies and
 * redirects onto a test file. The shell half is a best effort, not a sandbox:
 * it is there to stop the obvious routes, and to say why.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ALLOW_FILE = '.claude/test-edits.allow'

const TEST_FILE = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/

export function isTestPath(rel) {
  return TEST_FILE.test(rel)
}

/** The hooks and the settings that register them: a fence the agent could lift is no fence. */
export function isGuardPath(rel) {
  return rel === '.claude/settings.json' || rel.startsWith('.claude/hooks/')
}

export function readAllowList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else {
        re += '.*'
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

// ── Paths ────────────────────────────────────────────────────────────────────

function toPosix(p) {
  return p.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, '$1:/')
}

function isAbsolute(p) {
  return /^[a-zA-Z]:\//.test(p) || p.startsWith('/')
}

function normalize(p) {
  const drive = p.match(/^[a-zA-Z]:/)?.[0] ?? ''
  const parts = []
  for (const part of p.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${drive}/${parts.join('/')}`
}

function resolve(base, p) {
  const posix = toPosix(p)
  return normalize(isAbsolute(posix) ? posix : `${toPosix(base)}/${posix}`)
}

/** The path relative to the project, or null when it lies outside it. */
function relative(projectDir, abs) {
  const root = normalize(toPosix(projectDir))
  if (abs.toLowerCase() === root.toLowerCase()) return ''
  const prefix = `${root}/`.toLowerCase()
  return abs.toLowerCase().startsWith(prefix) ? abs.slice(prefix.length) : null
}

// ── Shell parsing ────────────────────────────────────────────────────────────

/**
 * Split a command into simple commands, each with its words and the files its
 * output is redirected to. Quotes are honoured; the rest of shell grammar is not.
 */
function parseShell(command, escapeChar) {
  const segments = []
  let words = []
  let redirects = []
  let word = null
  let pendingRedirect = false
  let text = ''

  const endWord = () => {
    if (word === null) return
    if (pendingRedirect) redirects.push(word)
    else words.push(word)
    pendingRedirect = false
    word = null
  }
  const endSegment = () => {
    endWord()
    if (words.length || redirects.length) segments.push({ words, redirects, text })
    words = []
    redirects = []
    text = ''
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1)
      const end = close === -1 ? command.length : close
      word = (word ?? '') + command.slice(i + 1, end)
      text += command.slice(i, end + 1)
      i = end
      continue
    }
    text += c
    if (c === escapeChar && i + 1 < command.length) {
      word = (word ?? '') + command[++i]
      text += command[i]
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endSegment()
    } else if (c === '>') {
      // A leading fd (`2>`) belongs to the operator, not a word.
      if (word !== null && /^\d+$/.test(word)) word = null
      endWord()
      while (command[i + 1] === '>' || command[i + 1] === '|') text += command[++i]
      // `2>&1`, `>&2`: a redirect to another fd, not to a file.
      if (command[i + 1] === '&') {
        text += command[++i]
        while (/\d/.test(command[i + 1] ?? '')) text += command[++i]
      } else {
        pendingRedirect = true
      }
    } else if (c === '<') {
      endWord()
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word = (word ?? '') + c
    }
  }
  endSegment()
  return segments
}

const DELETE_VERBS = new Set([
  'rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'mv', 'move', 'ren', 'rename',
  'remove-item', 'ri', 'move-item', 'mi', 'rename-item', 'rni',
])
const WRITE_VERBS = new Set([
  'truncate', 'tee', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'clear-content', 'clc',
])
const IN_PLACE_VERBS = new Set(['sed', 'perl'])
const COPY_VERBS = new Set(['cp', 'copy', 'copy-item', 'cpi', 'install'])
const CD_VERBS = new Set(['cd', 'set-location', 'sl', 'pushd', 'chdir'])
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'deno', 'bun', 'tsx'])
const WRITES_FILES =
  /writeFile|appendFile|unlink|rmSync|rmdir|renameSync|truncate|createWriteStream|os\.remove|shutil|write_text|open\([^)]*['"][wa]/

function verbOf(words) {
  let i = 0
  while (i < words.length && (/^\w+=/.test(words[i]) || ['sudo', 'env', 'command'].includes(words[i]))) i++
  const verb = (words[i] ?? '').replace(/^.*\//, '').replace(/\.exe$/i, '').toLowerCase()
  return { verb, args: words.slice(i + 1) }
}

/** What each simple command writes or deletes, as {kind, path} relative to its cwd. */
function shellTargets(command, cwd, escapeChar, candidates, projectDir) {
  const targets = []
  let dir = cwd
  for (const { words, redirects, text } of parseShell(command, escapeChar)) {
    for (const r of redirects) targets.push({ kind: 'file', abs: resolve(dir, r) })
    let { verb, args } = verbOf(words)
    if (verb === 'git' && ['rm', 'mv'].includes(args[0])) {
      verb = args[0]
      args = args.slice(1)
    }
    const operands = args.filter((a) => a && !a.startsWith('-'))

    if (CD_VERBS.has(verb)) {
      if (operands[0]) dir = resolve(dir, operands[0])
    } else if (DELETE_VERBS.has(verb)) {
      for (const a of operands) targets.push({ kind: 'tree', abs: resolve(dir, a) })
    } else if (WRITE_VERBS.has(verb)) {
      for (const a of operands) targets.push({ kind: 'file', abs: resolve(dir, a) })
    } else if (IN_PLACE_VERBS.has(verb) && args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) {
      for (const a of operands) targets.push({ kind: 'file', abs: resolve(dir, a) })
    } else if (COPY_VERBS.has(verb) && operands.length > 1) {
      targets.push({ kind: 'file', abs: resolve(dir, operands.at(-1)) })
    } else if (verb === 'find' && /\.(test|spec)\./.test(text) && /-delete\b|-exec\s+rm\b/.test(text)) {
      const nameAt = args.indexOf('-name')
      const name = nameAt === -1 ? null : globToRegExp(args[nameAt + 1] ?? '*')
      const firstFlag = args.findIndex((a) => a.startsWith('-'))
      const roots = firstFlag === -1 ? args : args.slice(0, firstFlag)
      for (const root of roots.length ? roots : ['.']) {
        targets.push({ kind: 'tree', abs: resolve(dir, root), name })
      }
    } else if (INTERPRETERS.has(verb) && WRITES_FILES.test(text)) {
      for (const rel of candidates) {
        const abs = resolve(projectDir, rel)
        const fromDir = relative(dir, abs)
        const mentions = [rel, fromDir].filter(Boolean).flatMap((p) => [p, p.replace(/\//g, '\\')])
        if (mentions.some((m) => text.includes(m))) targets.push({ kind: 'file', abs })
      }
    }
  }
  return targets
}

// ── Decision ─────────────────────────────────────────────────────────────────

/**
 * The protected files this tool call would change: committed tests and the
 * committed guardrails (unless the allow list names them), and the allow list
 * itself. Empty means let it through.
 */
export function blockedTargets({ toolName, toolInput, projectDir, cwd, trackedTests, trackedGuards = new Set(), allow }) {
  const candidates = [...trackedTests, ...trackedGuards, ALLOW_FILE]
  const allowed = allow.map(globToRegExp)
  let targets = []

  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    const p = toolInput.file_path ?? toolInput.notebook_path
    if (p) targets = [{ kind: 'file', abs: resolve(cwd ?? projectDir, p) }]
  } else if (toolName === 'Bash' || toolName === 'PowerShell') {
    const escapeChar = toolName === 'PowerShell' ? '`' : '\\'
    targets = shellTargets(toolInput.command ?? '', cwd ?? projectDir, escapeChar, candidates, projectDir)
  }

  const hit = new Set()
  for (const t of targets) {
    const rel = relative(projectDir, t.abs)
    if (rel === null) continue
    const pattern = /[*?]/.test(rel) ? globToRegExp(rel) : null
    for (const c of candidates) {
      const inTree = t.kind === 'tree' && (rel === '' || c.startsWith(`${rel}/`))
      const named = !t.name || t.name.test(c.slice(c.lastIndexOf('/') + 1))
      if ((c === rel || pattern?.test(c) || inTree) && named) hit.add(c)
    }
  }

  return candidates
    .filter((c) => hit.has(c))
    .filter((c) => c === ALLOW_FILE || !allowed.some((re) => re.test(c)))
    .map((path) => ({ path, override: path === ALLOW_FILE }))
}

export function blockMessage(blocked) {
  const lines = []
  const tests = blocked.filter((b) => !b.override).map((b) => b.path)
  if (tests.length) {
    lines.push(
      `Blocked: this would change committed test (or test-guardrail) file(s):`,
      ...tests.map((t) => `  - ${t}`),
      '',
      'Tests here verify behaviour. A failing test means the code is wrong, not the test —',
      'fix the code. Never skip, loosen, special-case or delete a test to make it pass.',
      '',
      'If this task genuinely needs the test changed (the spec changed, or the test is',
      `wrong), stop and ask the human. They can allow it by adding the path or a glob to`,
      `${ALLOW_FILE}, one per line.`,
    )
  }
  if (blocked.some((b) => b.override)) {
    if (lines.length) lines.push('')
    lines.push(`Blocked: only a human writes ${ALLOW_FILE}. Ask them to.`)
  }
  return lines.join('\n')
}

// ── Hook entry point ─────────────────────────────────────────────────────────

function git(projectDir, args) {
  return execFileSync('git', ['-C', projectDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (process.env.ALLOW_TEST_EDITS === '1') return
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd
  const tracked = git(projectDir, ['ls-files', '-z']).split('\0')
  const trackedTests = new Set(tracked.filter(isTestPath))
  const trackedGuards = new Set(tracked.filter(isGuardPath))
  const allowPath = `${projectDir}/${ALLOW_FILE}`
  const allow = existsSync(allowPath) ? readAllowList(readFileSync(allowPath, 'utf8')) : []

  const blocked = blockedTargets({
    toolName: input.tool_name,
    toolInput: input.tool_input ?? {},
    projectDir,
    cwd: input.cwd,
    trackedTests,
    trackedGuards,
    allow,
  })
  if (blocked.length) {
    process.stderr.write(`${blockMessage(blocked)}\n`)
    process.exit(2)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    // A bug here must not wedge every tool call. Exit 1 shows the error to the
    // human and lets the call through.
    process.stderr.write(`protect-tests hook failed: ${err?.stack ?? err}\n`)
    process.exit(1)
  }
}
