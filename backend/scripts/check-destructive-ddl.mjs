// Destructive-DDL gate (spec section 13). Fails CI when a migration.sql ADDED relative to the base ref
// contains DROP / RENAME / SET NOT NULL / ALTER TYPE, unless the head commit message carries
// "allow-destructive". Destructive changes ship one tag after the code stops using them.
//
// Env: BASE_REF  git ref to diff against (default: merge-base with origin/main, else HEAD~1)
//      COMMIT_MESSAGE  override for the head commit message (tests)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RULES = [
  { name: 'DROP', re: /\bDROP\b/i },
  { name: 'RENAME', re: /\bRENAME\b/i },
  { name: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
  { name: 'ALTER TYPE', re: /\bALTER\s+TYPE\b/i },
  { name: 'ALTER COLUMN TYPE', re: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i },
]

function stripComments(sql) {
  // Replace with same-length blanks of newlines preserved so line numbers survive.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '')
}

/** @returns {{line: number, rule: string, text: string}[]} one entry per offending line */
export function findDestructive(sql) {
  const out = []
  stripComments(sql)
    .split('\n')
    .forEach((text, i) => {
      const rule = RULES.find((r) => r.re.test(text))
      if (rule) out.push({ line: i + 1, rule: rule.name, text: text.trim() })
    })
  return out
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function resolveBase() {
  const given = process.env.BASE_REF
  if (given && !/^0+$/.test(given)) {
    try {
      git("rev-parse", "--verify", "--quiet", `${given}^{commit}`)
      return given
    } catch {
      /* unknown ref (e.g. force-pushed before-sha): fall through */
    }
  }
  try {
    return git('merge-base', 'HEAD', 'origin/main')
  } catch {
    return 'HEAD~1'
  }
}

function headMessages() {
  if (process.env.COMMIT_MESSAGE) return process.env.COMMIT_MESSAGE
  let msg = git('log', '-1', '--format=%B', 'HEAD')
  // On pull_request events HEAD is a synthetic merge commit; the author's commit is its second parent.
  try {
    msg += '\n' + git('log', '-1', '--format=%B', 'HEAD^2')
  } catch {
    /* not a merge commit */
  }
  return msg
}

function main() {
  const base = resolveBase()
  const added = git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'backend/prisma/migrations/*/migration.sql')
    .split('\n')
    .filter(Boolean)
  console.log(`destructive-ddl: base ${base}, ${added.length} added migration(s)`)

  const findings = added.flatMap((file) => findDestructive(readFileSync(file, 'utf8')).map((f) => ({ file, ...f })))
  if (findings.length === 0) return 0

  if (/allow-destructive/.test(headMessages())) {
    console.log(`destructive-ddl: ${findings.length} destructive statement(s) allowed by "allow-destructive" in the commit message`)
    return 0
  }
  for (const f of findings) console.error(`${f.file}:${f.line}: ${f.rule}: ${f.text}`)
  console.error('destructive-ddl: destructive migration. Ship it one tag after the code stops using the column/table,')
  console.error('and put "allow-destructive" in the head commit message.')
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main())
