import { test, expect } from './fixtures'
import { apply, approve, heldRoom, newOwnerWorld, newStudent, sql, trpcPost, watch, expectHttpErrors } from './seams'

// Diskon Kampus Mitra: the discount applies only to verified students of an affiliated campus (BINUS is seeded as one).

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const OTHER_CAMPUS = 'ui-depok' // seeded, not affiliated
const DISCOUNT = 100_000
const FIRST_INVOICE = 1_525_000

test('a verified BINUS student sees Diskon Kampus Mitra at checkout and the approved invoice carries it', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'aff-binus', campus: true, price: 1_500_000, discount: DISCOUNT })
  // heldRoom already applied and approved; a second room-less look at checkout needs a fresh student and room.
  const owner = await newOwnerWorld(browser, { label: 'aff-binus-co', rooms: 1, price: 1_500_000, discount: DISCOUNT })
  const student = await newStudent(browser, { label: 'aff-binus-co-stu', campus: true })
  watch(student.page, problems)
  try {
    await test.step('checkout shows the discount row and the active card', async () => {
      await student.page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
      await expect(student.page.getByRole('heading', { name: 'Diskon Kampus Mitra' })).toBeVisible()
      await expect(student.page.getByText(/Potongan Rp\s?100\.000 untuk pembayaran pertama/)).toBeVisible()
      await expect(student.page.locator('aside').getByText('Diskon Kampus Mitra', { exact: true })).toBeVisible()
      await expect(student.page.getByText(/tidak berlaku untuk/)).toHaveCount(0)
    })

    await test.step('after approval the invoice is the discounted amount', async () => {
      const [{ amount }] = await sql<{ amount: number }>('SELECT amount FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(amount).toBe(FIRST_INVOICE - DISCOUNT)
    })

    await test.step('the kuitansi lists the discount line', async () => {
      const { receiptNumber } = await trpcPost<{ receiptNumber: number }>(held.owner.ctx, 'payment.recordManual', {
        kosId: held.owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE - DISCOUNT,
      })
      await held.student.page.goto(`/kuitansi/${receiptNumber}`)
      const breakdown = held.student.page.getByRole('term').filter({ hasText: 'Diskon Kampus Mitra' })
      await expect(breakdown).toBeVisible()
    })
    expectHttpErrors(problems)
  } finally {
    await Promise.all([held.owner.ctx.close(), held.student.ctx.close(), owner.ctx.close(), student.ctx.close()])
  }
})

test('a verified student at a non-partner campus is told the discount does not apply, with the partner list', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'aff-other', rooms: 2, price: 1_500_000, discount: DISCOUNT })
  const student = await newStudent(browser, { label: 'aff-other-stu', campus: OTHER_CAMPUS })
  watch(student.page, problems)
  try {
    await student.page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
    await expect(student.page.getByText(/Diskon Kampus Mitra tidak berlaku untuk .*UI|Diskon Kampus Mitra tidak berlaku untuk/).first()).toBeVisible()
    await expect(student.page.locator('aside').getByText('Diskon Kampus Mitra', { exact: true })).toHaveCount(0)

    await student.page.getByRole('button', { name: 'Lihat kampus mitra' }).first().click()
    const list = student.page.locator('.kobo-popover').filter({ hasText: 'Kampus mitra KoBo' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('listitem').filter({ hasText: /BINUS/i }).first()).toBeVisible()

    await test.step('the invoice carries no discount', async () => {
      const applicationId = await apply(student, owner.rooms[0].id)
      await approve(owner, owner.kosId, applicationId)
      const [{ amount }] = await sql<{ amount: number }>(
        'SELECT i.amount FROM "Invoice" i JOIN "RentalApplication" a ON a."tenancyId" = i."tenancyId" WHERE a.id = $1', [applicationId])
      expect(amount).toBe(FIRST_INVOICE)
    })
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('the owner form help names the partner campuses', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'aff-form', rooms: 1 })
  watch(owner.page, problems)
  try {
    await owner.page.goto('/owner/kos')
    await owner.page.getByRole('button', { name: 'Tambah kos' }).first().click()
    await expect(owner.page.getByText(/Berlaku untuk mahasiswa terverifikasi dari kampus mitra KoBo \(saat ini: .*BINUS.*\)\./i)).toBeVisible()
    expectHttpErrors(problems)
  } finally {
    await owner.ctx.close()
  }
})
