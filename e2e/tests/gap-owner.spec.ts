import { test, expect } from '../gap/fixtures'
import { apply, approve, expectHttpErrors, newOwnerWorld, newStudent, sql, trpcPost, trpcRaw, watch } from '../gap/helpers'

// Owner workspace gaps: inbox counts from hand-made rows, the student's rupiah after approval, and the cross-owner wall in the browser.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const VIEWPORTS = [
  { width: 1280, height: 650 },
  { width: 390, height: 844 },
]

test('[G-050][R-104] "Perlu tindakan" counts exactly the pending applications and scheduled surveys, and approving one lowers it', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'inbox', rooms: 2, price: 1_500_000, discount: 200_000 })
  const first = await newStudent(browser, { label: 'inbox-a', campus: true })
  const second = await newStudent(browser, { label: 'inbox-b' })
  watch(owner.page, problems)
  watch(first.page, problems)
  try {
    const appA = await apply(first, owner.rooms[0].id)
    await apply(second, owner.rooms[1].id)
    await trpcPost(first.page, 'visit.create', { kosId: owner.kosId, date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), timeSlot: 'PAGI' })

    // Before the decision the student sees a pending application, not a held room (spec: no hold before approval).
    await first.page.goto('/my-kos')
    await first.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
    await expect(first.page.getByText('Menunggu Pemilik').first()).toBeVisible()

    for (const vp of VIEWPORTS) {
      await owner.page.setViewportSize(vp)
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
      await expect(owner.page.getByRole('tab', { name: /Perlu tindakan/ })).toContainText('3')
    }

    await approve(owner, owner.kosId, appA)
    await owner.page.reload()
    // one pending application (second student) + one scheduled survey; the approved one is now the student's to pay
    await expect(owner.page.getByRole('tab', { name: /Perlu tindakan/ })).toContainText('2')

    // The student's first payment is rent + application fee - student discount, in whole rupiah: 1,500,000 + 25,000 - 200,000.
    for (const vp of VIEWPORTS) {
      await first.page.setViewportSize(vp)
      await first.page.goto('/my-kos')
      await expect(first.page.getByText(/1\.325\.000/).first()).toBeVisible()
    }
    const [{ amount }] = await sql<{ amount: number }>('SELECT i.amount FROM "Invoice" i JOIN "RentalApplication" a ON a."tenancyId" = i."tenancyId" WHERE a.id = $1', [appA])
    expect(amount).toBe(1_325_000)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), first.ctx.close(), second.ctx.close()])
  }
})

test('[G-051][R-002] owner B never sees owner A\'s kos in the browser, cannot read it through the API, and B\'s own edit persists after reload', async ({ browser, problems }) => {
  const a = await newOwnerWorld(browser, { label: 'wall-a', rooms: 1, price: 1_500_000 })
  const b = await newOwnerWorld(browser, { label: 'wall-b', rooms: 1, price: 1_600_000 })
  watch(b.page, problems)
  try {
    for (const vp of VIEWPORTS) {
      await b.page.setViewportSize(vp)
      for (const url of [`/owner/dashboard?kos=${a.kosId}`, `/owner/dashboard?kos=${a.kosId}&tab=tindakan`, '/owner/kos']) {
        await b.page.goto(url)
        await expect.poll(() => b.page.getByText(b.kosName).count()).toBeGreaterThan(0)
        await expect(b.page.getByText(a.kosName)).toHaveCount(0)
      }
    }

    const board = await b.page.request.get(`/api/trpc/owner.board?input=${encodeURIComponent(JSON.stringify({ kosId: a.kosId }))}`)
    expect(board.status()).toBe(403)
    expect((await board.json()).error.message).toBe('Anda tidak memiliki akses ke kos ini.')
    const roomA = a.rooms[0]
    const write = await trpcRaw(b.page, 'owner.room.update', { kosId: a.kosId, roomId: roomA.id, roomNumber: '999', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1 })
    expect(write.status).toBe(403)
    const [stored] = await sql<{ roomNumber: string; priceMonthly: number }>('SELECT "roomNumber", "priceMonthly" FROM "Room" WHERE id = $1', [roomA.id])
    expect(stored).toEqual({ roomNumber: roomA.roomNumber, priceMonthly: 1_500_000 })

    // B's own write works and survives a reload, on the public page the students use.
    const roomB = b.rooms[0]
    await trpcPost(b.page, 'owner.room.update', { kosId: b.kosId, roomId: roomB.id, roomNumber: roomB.roomNumber, floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1_800_000 })
    await b.page.goto(`/kos/${b.kosId}`)
    await expect(b.page.getByText(/1\.800\.000/).first()).toBeVisible()
    await b.page.reload()
    await expect(b.page.getByText(/1\.800\.000/).first()).toBeVisible()
    expectHttpErrors(problems, 403)
  } finally {
    await Promise.all([a.ctx.close(), b.ctx.close()])
  }
})
