// X-01 guard: production runs backend/src with Node's strip-only type stripping (no tsx).
// TS-only syntax (parameter properties, enums, namespaces) crashes the server at import.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const backendDir = fileURLToPath(new URL('../..', import.meta.url))
const srcDir = join(backendDir, 'src')
// The production image runs the operator CLIs with plain node too (E-05), so scripts/ must be strip-only clean as well.
const scriptsDir = join(backendDir, 'scripts')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'generated' ? [] : sourceFiles(p)
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [p] : []
  })
}

describe('strip-only TypeScript (X-01)', () => {
  it('every hand-written backend/src and backend/scripts file uses only erasable syntax', () => {
    const failures: string[] = []
    for (const file of [...sourceFiles(srcDir), ...sourceFiles(scriptsDir)]) {
      try {
        stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' })
      } catch (err) {
        failures.push(`${relative(backendDir, file)}: ${(err as Error).message.split('\n')[0]}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('src/app.ts imports under plain node (whole module graph)', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./src/app.ts'); console.log('ok')"], {
      cwd: backendDir,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(out.trim().split('\n').at(-1)).toBe('ok')
  })
})
