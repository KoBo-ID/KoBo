import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, kosInput, newOwner, roomInput, startIn } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

describe('[G-037][R-074] deleting a kos or room that still has a pending application', () => {
  it('is refused until the application is decided, then succeeds', async () => {
    const o = await newOwner()
    const kos = await o.c.owner.kos.create(kosInput() as never)
    const room = await o.c.owner.room.create({ ...roomInput(), kosId: kos.id } as never)
    const renter = await newStudent()
    const app = await callerFor(renter.id).application.create({ roomId: room.id, startDate: startIn(4), durationMonths: 3, occupation: 'Mahasiswa' })

    const roomE = await err(o.c.owner.room.delete({ kosId: kos.id, roomId: room.id }))
    const kosE = await err(o.c.owner.kos.delete({ kosId: kos.id }))
    expect([roomE?.code, kosE?.code]).toEqual(['CONFLICT', 'CONFLICT'])
    expect(roomE?.message).toBe('Kamar ini masih memiliki pengajuan sewa yang perlu diputuskan.')
    expect(kosE?.message).toBe('Kos ini masih memiliki pengajuan sewa yang perlu diputuskan.')
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(1)
    expect(await prisma.kos.count({ where: { id: kos.id } })).toBe(1)

    await o.c.application.decide({ kosId: kos.id, applicationId: app.id, decision: 'REJECT' })
    await o.c.owner.room.delete({ kosId: kos.id, roomId: room.id })
    await o.c.owner.kos.delete({ kosId: kos.id })
    expect(await prisma.kos.count({ where: { id: kos.id } })).toBe(0)
  })
})
