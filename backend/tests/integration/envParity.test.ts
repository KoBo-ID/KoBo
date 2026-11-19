import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Env parity (audit E-01): every environment variable the hand-written backend source reads must be documented in
 * backend/.env.example (commented-out lines count), or sit in ALLOWLIST below with a reason. A later build (e.g.
 * WhatsApp) that adds a variable must document it in .env.example or append it here.
 */
const backendDir = fileURLToPath(new URL('../../', import.meta.url))
const srcDir = join(backendDir, 'src')

/** Names deliberately NOT in .env.example. One-line reason each. */
const ALLOWLIST: Record<string, string> = {
  NODE_ENV: 'set by the runtime / Dockerfile / test runner, never configured by hand',
  ALLOW_FAKE_STORAGE: 'e2e only: lets a production-mode server use the in-memory storage; never on a real server',
  FRONTEND_DIST: 'override of the built SPA directory; the image layout already sets the right default',
  KOBO_SEED_FILE: 'data-job only: alternative seed snapshot for npm run db:seed',
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'generated' ? [] : walk(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Env variable names read by one source file: member reads, bracket reads, helper calls and destructuring. */
export function envNamesRead(source: string): Set<string> {
  const code = stripComments(source)
  const names = new Set<string>()
  const add = (re: RegExp, group = 1) => {
    for (const m of code.matchAll(re)) names.add(m[group]!)
  }
  add(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]*)\b/g)
  add(/\b(?:process\.)?env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)
  add(/\b(?:requireEnv|requireTrimmedEnv|oneOf)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.)?env\b/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/[\s:=]/)[0]
      if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) names.add(name)
    }
  }
  return names
}

const documented = (): Set<string> => {
  const text = readFileSync(join(backendDir, '.env.example'), 'utf8')
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!))
}

describe('env parity: backend/src vs backend/.env.example', () => {
  it('the scanner sees destructured and helper reads', () => {
    const found = envNamesRead("const { R2_A, R2_B: b } = env\nrequireEnv('DATABASE_URL')\nprocess.env.X_Y\n// env.COMMENTED")
    expect([...found].sort()).toEqual(['DATABASE_URL', 'R2_A', 'R2_B', 'X_Y'])
  })

  it('every variable read by the source is documented or allowlisted', () => {
    const readBy = new Map<string, string>()
    for (const file of walk(srcDir)) {
      for (const name of envNamesRead(readFileSync(file, 'utf8'))) if (!readBy.has(name)) readBy.set(name, relative(backendDir, file))
    }
    expect(readBy.size).toBeGreaterThan(20)
    const docs = documented()
    const missing = [...readBy].filter(([name]) => !docs.has(name) && !(name in ALLOWLIST)).map(([name, file]) => `${name} (${file})`)
    expect(missing, 'add these to backend/.env.example, or to ALLOWLIST with a reason').toEqual([])
  })

  it('the allowlist holds no stale or already-documented names', () => {
    const docs = documented()
    const all = new Set<string>()
    for (const file of walk(srcDir)) for (const name of envNamesRead(readFileSync(file, 'utf8'))) all.add(name)
    const stale = Object.keys(ALLOWLIST).filter((n) => !all.has(n) || docs.has(n))
    expect(stale).toEqual([])
  })
})
