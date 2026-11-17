import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDestructive } from './check-destructive-ddl.mjs'

const script = fileURLToPath(new URL('./check-destructive-ddl.mjs', import.meta.url))

test('flags DROP, RENAME, SET NOT NULL, ALTER TYPE, ALTER COLUMN TYPE', () => {
  const cases = [
    'ALTER TABLE "Kos" DROP COLUMN "x";',
    'drop table "Kos";',
    'DROP INDEX "idx";',
    'ALTER TABLE "Kos" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "Kos" ALTER COLUMN "a" SET NOT NULL;',
    "ALTER TYPE \"Role\" ADD VALUE 'X';",
    'ALTER TABLE "Kos" ALTER COLUMN "a" TYPE bigint;',
  ]
  for (const sql of cases) assert.equal(findDestructive(sql).length, 1, sql)
})

test('allows additive DDL and ignores comments and identifiers that merely contain the words', () => {
  const sql = `
    -- DROP TABLE in a comment
    /* RENAME COLUMN in a block comment */
    CREATE TABLE "Dropoff" ("id" TEXT NOT NULL, "renamed_at" TIMESTAMPTZ);
    ALTER TABLE "Kos" ADD COLUMN "note" TEXT;
    CREATE UNIQUE INDEX "u" ON "Kos"("slug");
    ALTER TABLE "Kos" ALTER COLUMN "a" DROP NOT NULL;
  `
  // "DROP NOT NULL" is a relaxation but still contains DROP; the rule is deliberately blunt.
  assert.deepEqual(findDestructive(sql).map((f) => f.line), [7])
})

test('reports line numbers', () => {
  const hits = findDestructive('CREATE TABLE a ();\n\nDROP TABLE a;\n')
  assert.deepEqual(hits.map((h) => h.line), [3])
})

function repoWithMigration(sql, headMessage) {
  const dir = mkdtempSync(join(tmpdir(), 'ddl-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  git('config', 'commit.gpgsign', 'false')
  const m = (n) => join(dir, 'backend/prisma/migrations', n)
  mkdirSync(m('20260101000000_old'), { recursive: true })
  // An OLD migration with DROP must never be flagged: only added files count.
  writeFileSync(join(m('20260101000000_old'), 'migration.sql'), 'DROP TABLE legacy;\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  mkdirSync(m('20260102000000_new'), { recursive: true })
  writeFileSync(join(m('20260102000000_new'), 'migration.sql'), sql)
  git('add', '.')
  git('commit', '-q', '-m', headMessage)
  return dir
}
const run = (dir) => spawnSync('node', [script], { cwd: dir, env: { ...process.env, BASE_REF: 'main' }, encoding: 'utf8' })

test('CLI: fails on added destructive migration', () => {
  const dir = repoWithMigration('ALTER TABLE a DROP COLUMN b;', 'add migration')
  try {
    const r = run(dir)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /20260102000000_new/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: passes with allow-destructive in head commit message', () => {
  const dir = repoWithMigration('ALTER TABLE a DROP COLUMN b;', 'drop b\n\nallow-destructive')
  try {
    assert.equal(run(dir).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: passes on additive migration and ignores pre-existing destructive ones', () => {
  const dir = repoWithMigration('ALTER TABLE a ADD COLUMN b TEXT;', 'add b')
  try {
    assert.equal(run(dir).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
