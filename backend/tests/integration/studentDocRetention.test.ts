import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { deleteUserStudentDocuments, purgeStudentDocuments } from '../../src/studentDocRetention.ts'
import { newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const NOW = new Date('2026-12-01T00:00:00.000Z')
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

async function doc(userId: string, tag: string, deleteAfter: Date | null) {
  const key = `private/ktm/${userId}/${tag}.jpg`
  storage.putPrivate(key, JPEG, 'image/jpeg')
  const row = await prisma.studentDocument.create({ data: { userId, key, contentType: 'image/jpeg', status: 'REJECTED', deleteAfter, consentAt: NOW } })
  return { key, id: row.id }
}

describe('purgeStudentDocuments', () => {
  it('deletes only due documents, marks them deleted, and is idempotent', async () => {
    const s = await newStudent()
    const due = await doc(s.id, 'due', new Date('2026-11-30T00:00:00.000Z'))
    const exact = await doc(s.id, 'exact', NOW)
    const later = await doc(s.id, 'later', new Date('2026-12-02T00:00:00.000Z'))
    const none = await doc(s.id, 'none', null)

    expect(await purgeStudentDocuments(prisma, storage, NOW)).toBe(2)
    expect(storage.hasPrivate(due.key)).toBe(false)
    expect(storage.hasPrivate(exact.key)).toBe(false)
    expect(storage.hasPrivate(later.key)).toBe(true)
    expect(storage.hasPrivate(none.key)).toBe(true)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: due.id } })).deletedAt).toEqual(NOW)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: later.id } })).deletedAt).toBeNull()

    expect(await purgeStudentDocuments(prisma, storage, NOW)).toBe(0)
    expect(await purgeStudentDocuments(prisma, storage, new Date('2026-12-03T00:00:00.000Z'))).toBe(1)
    expect(storage.hasPrivate(later.key)).toBe(false)
  })
})

describe('deleteUserStudentDocuments', () => {
  it('removes every stored object of that user only', async () => {
    const a = await newStudent()
    const b = await newStudent()
    const a1 = await doc(a.id, 'a1', null)
    const b1 = await doc(b.id, 'b1', null)
    expect(await deleteUserStudentDocuments(prisma, storage, a.id)).toBe(1)
    expect(storage.hasPrivate(a1.key)).toBe(false)
    expect(storage.hasPrivate(b1.key)).toBe(true)
  })
})
