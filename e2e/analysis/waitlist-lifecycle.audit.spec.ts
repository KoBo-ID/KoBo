import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test, expect } from './safe-fixtures'
import { expectHttpErrors, expireHold, expireOffer, heldRoom, newOwnerWorld, newStudent, sql, tick, trpcPost, watch, type HeldRoom, type Student } from '../tests/seams'

// The queue for a full kos, beyond what waitlist.spec.ts covers (demo student, owner cancels a booking): position numbers,
// leaving, the five-entry limit, a declined or lapsed offer passing to the next student, and the owner removing someone.
// Each test builds its own kos whose only room is held by a student, so the kos is "full" until the hold is lapsed on purpose.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))
const entryStatus = async (id: string) => (await sql<{ status: string; offeredRoomId: string | null }>('SELECT status, "offeredRoomId" FROM "WaitlistEntry" WHERE id = $1', [id]))[0]
const offerMails = async (to: string) => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [to, 'waitlist-offer'])).length
const toast = (page: Page, text: string) => page.getByText(text)

async function joinApi(s: Student, kosId: string) {
  return trpcPost<{ id: string; position: number }>(s.ctx, 'waitlist.join', { kosId, roomType: null })
}

/** A full kos (its one room held) plus `waiters` queued students, joined in order. */
async function fullKos(browser: Browser, label: string, waiters: number, problems: string[]) {
  const held = await heldRoom(browser, { label })
  const queue: { student: Student; entryId: string }[] = []
  for (let i = 0; i < waiters; i++) {
    const student = await newStudent(browser, { label: `${label}-w${i + 1}` })
    watch(student.page, problems)
    queue.push({ student, entryId: (await joinApi(student, held.owner.kosId)).id })
  }
  watch(held.owner.page, problems)
  const closeAllOf = () => closeAll(held.owner.ctx, held.student.ctx, ...queue.map((q) => q.student.ctx))
  return { held, queue, closeAllOf }
}

/** The hold lapses and the waitlist pass runs until the first waiter holds the offer. */
async function offerToFirst(held: HeldRoom, first: string, page: Page) {
  await expireHold(held.tenancyId)
  await expect
    .poll(async () => {
      await tick(page, 'waitlist')
      return (await entryStatus(first)).status
    })
    .toBe('OFFERED')
}

test('scenario 25: a student joins a full kos, sees the position, and leaves the queue', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'wl-join' })
  const a = await newStudent(browser, { label: 'wl-join-a' })
  const b = await newStudent(browser, { label: 'wl-join-b' })
  watch(a.page, problems)
  watch(b.page, problems)
  try {
    await test.step('the kos page says Kamar Penuh and joining puts the student at #1', async () => {
      await a.page.goto(`/kos/${held.owner.kosId}`)
      const join = a.page.getByTestId('waitlist-join')
      await expect(join).toContainText('Kamar Penuh')
      await join.getByRole('button', { name: 'Ikut Daftar Tunggu' }).click()
      await expect(toast(a.page, 'Anda masuk daftar tunggu. Kami kirim email saat kamar tersedia.')).toBeVisible()
      await expect(a.page.getByTestId('waitlist-queued')).toContainText('Anda di antrean #1')
      await expect(a.page.getByTestId('waitlist-queued')).toContainText('Anda punya 24 jam untuk memesan.')
    })

    await test.step('a second student is #2, and /my-kos lists the entry with its number', async () => {
      const second = await joinApi(b, held.owner.kosId)
      expect(second.position).toBe(2)
      await b.page.goto('/my-kos')
      await expect(b.page.getByTestId('waitlist-entry')).toContainText('Antrean #2')
    })

    await test.step('the first student leaves: the entry is LEFT and the second moves up to #1', async () => {
      await a.page.getByTestId('waitlist-queued').getByRole('button', { name: 'Keluar antrean' }).click()
      await expect(toast(a.page, 'Anda keluar dari daftar tunggu.')).toBeVisible()
      await expect(a.page.getByTestId('waitlist-join')).toContainText('Kamar Penuh')
      const [{ status }] = await sql<{ status: string }>('SELECT status FROM "WaitlistEntry" WHERE "userId" = $1 AND "kosId" = $2', [a.userId, held.owner.kosId])
      expect(status).toBe('LEFT')
      await b.page.reload()
      await expect(b.page.getByTestId('waitlist-entry')).toContainText('Antrean #1')
    })

    await test.step('the leaver finds the entry in the folded history', async () => {
      await a.page.goto('/my-kos')
      await a.page.getByText('Riwayat daftar tunggu (1)').click()
      await expect(a.page.getByRole('listitem').filter({ hasText: held.owner.kosName })).toContainText('Keluar antrean')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(held.owner.ctx, held.student.ctx, a.ctx, b.ctx)
  }
})

test('scenario 25: a student can queue in five kos at once, not six', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'wl-limit' })
  const student = await newStudent(browser, { label: 'wl-limit-s' })
  const others: BrowserContext[] = []
  watch(student.page, problems)
  try {
    // Five live entries in five other kos, one per owner (an owner may register at most 5 kos, so the other kos are not all one owner's).
    for (let i = 0; i < 5; i++) {
      const other = await newOwnerWorld(browser, { label: `wl-limit-o${i}`, rooms: 1 })
      others.push(other.ctx)
      await sql(`INSERT INTO "WaitlistEntry" (id, "kosId", "userId", status, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'WAITING', now())`, [other.kosId, student.userId])
    }
    await student.page.goto(`/kos/${held.owner.kosId}`)
    await student.page.getByTestId('waitlist-join').getByRole('button', { name: 'Ikut Daftar Tunggu' }).click()
    await expect(toast(student.page, 'Anda hanya bisa mengantre di 5 kos sekaligus.')).toBeVisible()
    await expect(student.page.getByTestId('waitlist-queued')).toHaveCount(0)
    expect(await sql('SELECT id FROM "WaitlistEntry" WHERE "userId" = $1 AND "kosId" = $2', [student.userId, held.owner.kosId])).toHaveLength(0)
    expectHttpErrors(problems, 400)
  } finally {
    await closeAll(held.owner.ctx, held.student.ctx, student.ctx, ...others)
  }
})

test('scenario 25: an offer arrives with a banner and an email; declining passes it to the next in line', async ({ browser, problems }) => {
  const { held, queue, closeAllOf } = await fullKos(browser, 'wl-offer', 2, problems)
  const [first, second] = queue
  const room = held.owner.rooms[0]
  try {
    await offerToFirst(held, first.entryId, held.owner.page)

    await test.step('only the first student is offered, by email and in /my-kos', async () => {
      expect(await entryStatus(second.entryId)).toMatchObject({ status: 'WAITING' })
      await expect.poll(() => offerMails(first.student.email)).toBe(1)
      expect(await offerMails(second.student.email)).toBe(0)
      await first.student.page.goto('/my-kos')
      const banner = first.student.page.getByTestId('waitlist-offer')
      await expect(banner).toContainText(`Kamar ${room.roomNumber} ditawarkan untukmu`)
      await expect(banner).toContainText('sisa')
      await expect(banner.getByRole('button', { name: 'Pesan Sekarang' })).toBeVisible()
      await second.student.page.goto('/my-kos')
      await expect(second.student.page.getByTestId('waitlist-entry')).toContainText('Antrean #1')
      await expect(second.student.page.getByTestId('waitlist-offer')).toHaveCount(0)
    })

    await test.step('Lewati declines it: the room moves to the second student at once', async () => {
      await first.student.page.getByTestId('waitlist-offer').getByRole('button', { name: 'Lewati' }).click()
      await expect(toast(first.student.page, 'Penawaran dilewati. Kamar diteruskan ke antrean berikutnya.')).toBeVisible()
      expect((await entryStatus(first.entryId)).status).toBe('DECLINED')
      expect(await entryStatus(second.entryId)).toEqual({ status: 'OFFERED', offeredRoomId: room.id })
      await expect.poll(() => offerMails(second.student.email)).toBe(1)
      await second.student.page.reload()
      await expect(second.student.page.getByTestId('waitlist-offer')).toContainText(`Kamar ${room.roomNumber} ditawarkan untukmu`)
    })

    await test.step('"Pesan Sekarang" opens the checkout for the offered room', async () => {
      await second.student.page.getByTestId('waitlist-offer').getByRole('button', { name: 'Pesan Sekarang' }).click()
      await expect(second.student.page).toHaveURL(new RegExp(`/checkout/${held.owner.kosId}\\?room=${room.id}`))
    })
    expectHttpErrors(problems)
  } finally {
    await closeAllOf()
  }
})

test('scenario 25: an offer that runs out is passed on by the waitlist pass', async ({ browser, problems }) => {
  const { held, queue, closeAllOf } = await fullKos(browser, 'wl-lapse', 2, problems)
  const [first, second] = queue
  try {
    await offerToFirst(held, first.entryId, held.owner.page)
    await expireOffer(first.entryId)

    await expect
      .poll(async () => {
        await tick(held.owner.page, 'waitlist')
        return [(await entryStatus(first.entryId)).status, (await entryStatus(second.entryId)).status]
      })
      .toEqual(['EXPIRED', 'OFFERED'])
    await expect.poll(() => offerMails(second.student.email)).toBe(1)

    await first.student.page.goto('/my-kos')
    await expect(first.student.page.getByTestId('waitlist-offer')).toHaveCount(0)
    await first.student.page.getByText('Riwayat daftar tunggu (1)').click()
    await expect(first.student.page.getByRole('listitem').filter({ hasText: held.owner.kosName })).toContainText('Penawaran habis')
    expectHttpErrors(problems)
  } finally {
    await closeAllOf()
  }
})

test('scenario 25: the owner removes a student from the queue', async ({ browser, problems }) => {
  const { held, queue, closeAllOf } = await fullKos(browser, 'wl-remove', 2, problems)
  const [first, second] = queue
  const { owner } = held
  try {
    await owner.page.goto(`/owner/kos?kos=${owner.kosId}`)
    const panel = owner.page.locator('section.owner-kos').filter({ has: owner.page.getByRole('heading', { name: /Daftar tunggu/ }) })
    await expect(panel.getByRole('heading', { name: /Daftar tunggu\s*2 pengantre/ })).toBeVisible()
    const rows = panel.getByTestId('owner-waitlist-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('#1')
    await expect(rows.nth(1)).toContainText('#2')

    await test.step('Hapus asks again before removing', async () => {
      await rows.nth(0).getByRole('button', { name: /^Hapus / }).click()
      await expect(rows.nth(0).getByRole('button', { name: 'Batal' })).toBeVisible()
      await rows.nth(0).getByRole('button', { name: 'Batal' }).click()
      expect((await entryStatus(first.entryId)).status).toBe('WAITING')
      await rows.nth(0).getByRole('button', { name: /^Hapus / }).click()
      await rows.nth(0).getByRole('button', { name: /^Hapus / }).click()
      await expect(toast(owner.page, 'Pengantre dihapus dari daftar tunggu.')).toBeVisible()
    })

    await test.step('the entry is REMOVED, the second student is now #1, and the removed one sees why', async () => {
      expect((await entryStatus(first.entryId)).status).toBe('REMOVED')
      await expect(panel.getByRole('heading', { name: /Daftar tunggu\s*1 pengantre/ })).toBeVisible()
      await second.student.page.goto('/my-kos')
      await expect(second.student.page.getByTestId('waitlist-entry')).toContainText('Antrean #1')
      await first.student.page.goto('/my-kos')
      await first.student.page.getByText('Riwayat daftar tunggu (1)').click()
      await expect(first.student.page.getByRole('listitem').filter({ hasText: owner.kosName })).toContainText('Dihapus pemilik')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAllOf()
  }
})
