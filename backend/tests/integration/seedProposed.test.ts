import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { prisma } from '../helpers.ts'

// The proposed seed comes from the data job and lives in the git-excluded notes/ folder, so this runs only where the file exists.
const FILE = join(import.meta.dirname, '..', '..', '..', 'notes', 'data-gathering', 'seed', 'seedData.proposed.json')

afterAll(async () => {
  delete process.env.KOBO_SEED_FILE
  await resetDb(prisma)
})

describe.skipIf(!existsSync(FILE))('KOBO_SEED_FILE with the proposed seed', () => {
  it('loads through seed.ts unchanged in shape, keeps the existing ids, adds the synthetic kos', async () => {
    await resetDb(prisma)
    const bundled = await prisma.kos.count()
    process.env.KOBO_SEED_FILE = FILE
    await resetDb(prisma)
    const ids = (await prisma.kos.findMany({ select: { id: true } })).map((k) => k.id)
    expect(ids.length).toBeGreaterThan(bundled)
    expect(ids).toEqual(expect.arrayContaining(['kos-1', 'kos-10', 'kos-p01', 'kos-p12']))
    expect(await prisma.campus.count({ where: { id: 'binus-syahdan' } })).toBe(1)
    const demoOwner = await prisma.user.findFirst({ where: { isDemo: true } })
    expect(demoOwner).not.toBeNull()
  })

  it('without the variable the bundled seed is used again', async () => {
    delete process.env.KOBO_SEED_FILE
    await resetDb(prisma)
    expect(await prisma.kos.count({ where: { id: 'kos-p01' } })).toBe(0)
  })
})
