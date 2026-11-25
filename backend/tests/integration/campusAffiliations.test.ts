import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, newStudent, prisma } from '../helpers.ts'
import { err, verifyAtCampus } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

describe('campus.affiliations', () => {
  it('is public and lists the active partner campuses with label and short name', async () => {
    const list = await caller.campus.affiliations()
    expect(list.map((r) => r.campusId)).toEqual(expect.arrayContaining(['binus']))
    for (const r of list) {
      expect(r.label).toBeTruthy()
      expect(r.shortName).toBeTruthy()
    }
  })

  it('omits inactive rows and returns [] when none is active', async () => {
    await prisma.campusAffiliation.updateMany({ where: { campusId: 'binus' }, data: { active: false } })
    expect((await caller.campus.affiliations()).map((r) => r.campusId)).not.toContain('binus')
    await prisma.campusAffiliation.updateMany({ data: { active: false } })
    expect(await caller.campus.affiliations()).toEqual([])
  })
})

describe('campus.myDiscountStatus', () => {
  it('refuses a signed-out caller', async () => {
    expect((await err(caller.campus.myDiscountStatus()))?.code).toBe('UNAUTHORIZED')
  })

  it('reports an unverified student', async () => {
    const s = await newStudent()
    expect(await callerFor(s.id).campus.myDiscountStatus()).toEqual({ campusId: null, campusName: null, affiliated: false, verified: false })
  })

  it('reports a verified student at a partner campus as affiliated with institution name', async () => {
    const s = await newStudent()
    await verifyAtCampus(s.id, 'binus-anggrek')
    const r = await callerFor(s.id).campus.myDiscountStatus()
    expect(r).toMatchObject({ campusId: 'binus-anggrek', campusName: 'BINUS University', affiliated: true, verified: true })
  })

  it('institution search returns only BINUS University, never location-specific BINUS branches', async () => {
    const inst = await caller.campus.search({ q: 'binus', scope: 'institution' })
    expect(inst.map((c) => ({ id: c.id, name: c.name }))).toEqual([{ id: 'binus', name: 'BINUS University' }])
    const loc = await caller.campus.search({ q: 'binus', scope: 'location' })
    expect(loc.some((c) => c.id === 'binus')).toBe(false)
  })

  it('reports a verified student at a non-partner campus as not affiliated', async () => {
    const s = await newStudent()
    await verifyAtCampus(s.id, 'ui-depok')
    expect(await callerFor(s.id).campus.myDiscountStatus()).toMatchObject({ campusId: 'ui-depok', affiliated: false, verified: true })
  })

  it('is not affiliated once the verification has expired', async () => {
    const s = await newStudent()
    await verifyAtCampus(s.id, 'binus-syahdan', new Date(Date.now() - 86_400_000))
    expect(await callerFor(s.id).campus.myDiscountStatus()).toMatchObject({ campusId: 'binus-syahdan', affiliated: false, verified: false })
  })
})
