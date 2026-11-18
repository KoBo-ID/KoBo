import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { listPending, ReviewError, showDocument } from '../../src/studentVerification/review.ts'
import { newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

describe('review module (used by scripts/review-students.ts)', () => {
  it('lists pending documents oldest first and shows one with a short-lived URL', async () => {
    const campus = await prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })
    const a = await newStudent()
    const b = await newStudent()
    const mk = (userId: string, at: string) => {
      const key = `private/ktm/${userId}/${at}.jpg`
      storage.putPrivate(key, JPEG, 'image/jpeg')
      return prisma.studentDocument.create({ data: { userId, key, contentType: 'image/jpeg', campusId: campus.id, nim: '123456', nameOnCard: 'Nama', consentAt: new Date(), createdAt: new Date(at) } })
    }
    const second = await mk(b.id, '2026-11-02T00:00:00Z')
    const first = await mk(a.id, '2026-11-01T00:00:00Z')
    const rows = await listPending(prisma)
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id])
    expect(rows[0]).toMatchObject({ email: a.email, campus: campus.shortName, nim: '123456' })

    const shown = await showDocument(prisma, storage, first.id)
    expect(shown).toMatchObject({ name: a.name, email: a.email, campus: campus.name, nim: '123456', nameOnCard: 'Nama' })
    expect(shown.url).toContain('/api/dev-private/')
    expect(shown.url).toMatch(/exp=(\d+)/)
    const exp = Number(/exp=(\d+)/.exec(shown.url)![1])
    expect(exp - Date.now()).toBeLessThanOrEqual(121_000)
  })

  it('refuses an unknown or deleted document', async () => {
    await expect(showDocument(prisma, storage, 'nope')).rejects.toBeInstanceOf(ReviewError)
  })
})
