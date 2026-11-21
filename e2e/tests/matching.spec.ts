import { test, expect } from './fixtures'
import { newStudent, watch, expectHttpErrors, trpcRaw, type Student } from './seams'
import { signUpVerified, ownIp } from './accounts'
import { MATCH, fillCore, backdateProfile, navLink } from './matching-helpers'

// Teman Sekamar end to end: two fresh verified students of the same gender (A, B) and a bystander (C), each in its own browser
// context. The steps run in order and share state, so the describe is serial.

test.describe.configure({ mode: 'serial' })

test.describe('teman sekamar', () => {
  let A: Student
  let B: Student
  let C: Student
  let nameA: string
  let nameB: string
  let connectionPath = ''
  const connectionId = () => connectionPath.split('/').pop()!
  const problems: { A: string[]; B: string[]; C: string[] } = { A: [], B: [], C: [] }

  test.beforeAll(async ({ browser }) => {
    const tag = Date.now().toString(36)
    nameA = `Alya${tag}`
    nameB = `Bela${tag}`
    A = await newStudent(browser, { label: 'mt-a', campus: true })
    B = await newStudent(browser, { label: 'mt-b', campus: true })
    C = await newStudent(browser, { label: 'mt-c', campus: true })
    watch(A.page, problems.A)
    watch(B.page, problems.B)
    watch(C.page, problems.C)
  })

  test.afterAll(async () => {
    await Promise.all([A, B, C].map((s) => s?.ctx.close()))
  })

  test('A builds a profile in two steps and a phone number in the intro is refused', async () => {
    const page = A.page
    await fillCore(page, nameA)
    const stepper = page.getByRole('navigation', { name: 'Langkah pendaftaran' })
    await expect(stepper.locator('[aria-current="step"]')).toContainText('Preferensi')
    await expect(page.getByText('Profilmu aktif.')).toBeVisible()

    const form = page.getByRole('form', { name: 'Preferensi opsional' })
    await form.getByLabel('Perkenalan singkat').fill('Hubungi aku di 081234567890 ya')
    await form.getByRole('button', { name: 'Simpan preferensi' }).click()
    await expect(form.getByRole('alert').filter({ hasText: 'Jangan bagikan nomor' })).toBeVisible()
    await expect(page).toHaveURL(/\/teman-sekamar\/profil$/)

    await form.getByLabel('Perkenalan singkat').fill('Mahasiswa semester 3, rajin dan rapi.')
    await form.getByRole('button', { name: 'Simpan preferensi' }).click()
    await expect(page).toHaveURL(/\/teman-sekamar$/)
    expect(problems.A).toEqual([])
  })

  test('B builds a profile, then both profiles are backdated past the 24 h rule', async () => {
    await fillCore(B.page, nameB)
    await B.page.getByRole('form', { name: 'Preferensi opsional' }).getByRole('button', { name: 'Lewati' }).click()
    await expect(B.page).toHaveURL(/\/teman-sekamar$/)
    await backdateProfile(A.userId)
    await backdateProfile(B.userId)
  })

  test('A finds B in discover with a score and opens the breakdown', async () => {
    const page = A.page
    await page.goto(MATCH)
    const card = page.getByRole('link', { name: new RegExp(nameB) })
    await expect(card).toBeVisible()
    await expect(card).toContainText(/\d+%/)
    await card.click()
    await expect(page).toHaveURL(/\/teman-sekamar\/p\//)
    await expect(page.getByRole('heading', { name: 'Kenapa cocok' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Rincian skor kecocokan' }).getByRole('listitem').first()).toContainText(/\d+ dari \d+ poin/)
  })

  test('A sends a request with an intro and B accepts it under Permintaan', async () => {
    const page = A.page
    await page.getByRole('button', { name: 'Ajak jadi teman sekamar' }).click()
    await page.getByLabel('Pesan perkenalan (opsional)').fill('Halo, boleh kenalan? Aku cari kos dekat kampus.')
    await page.getByRole('button', { name: 'Kirim permintaan' }).click()
    await expect(page.getByText('Permintaan terkirim.')).toBeVisible()

    const b = B.page
    await b.goto(`${MATCH}/permintaan`)
    await expect(b.getByRole('tab', { name: 'Diterima' })).toHaveAttribute('aria-selected', 'true')
    const row = b.getByRole('listitem').filter({ hasText: nameA })
    await expect(row).toContainText('Halo, boleh kenalan?')
    await expect(row).toContainText('Menunggu jawaban')
    await row.getByRole('button', { name: 'Terima' }).click()
    const started = b.getByRole('link', { name: 'Mulai ngobrol' })
    await expect(started).toBeVisible()
    connectionPath = new URL((await started.getAttribute('href'))!, 'http://x').pathname
    expect(connectionPath).toMatch(/\/teman-sekamar\/pesan\/.+/)
  })

  test('they chat both ways, B reaches A through the poll, and a phone number asks for confirmation', async () => {
    const a = A.page
    const b = B.page
    await a.goto(connectionPath)
    await b.goto(connectionPath)
    const boxA = a.getByLabel('Tulis pesan')
    await boxA.fill('Halo Bela, salam kenal!')
    await boxA.press('Enter')
    await expect(a.locator('.mc-msg').filter({ hasText: 'Halo Bela, salam kenal!' })).toBeVisible()
    // B has the thread open and polls every 10 s.
    await expect(b.locator('.mc-msg').filter({ hasText: 'Halo Bela, salam kenal!' })).toBeVisible({ timeout: 15_000 })

    const boxB = b.getByLabel('Tulis pesan')
    await boxB.fill('Halo juga Alya, senang kenal kamu.')
    await boxB.press('Enter')
    await expect(a.locator('.mc-msg').filter({ hasText: 'Halo juga Alya' })).toBeVisible({ timeout: 15_000 })

    // Contact details need a second tap.
    await boxA.fill('Ini nomorku 081234567890')
    await boxA.press('Enter')
    await expect(a.getByText('Yakin bagikan kontak?')).toBeVisible()
    await a.getByRole('button', { name: 'Batal' }).click()
    await expect(a.getByText('Yakin bagikan kontak?')).toHaveCount(0)
    await expect(a.locator('.mc-msg').filter({ hasText: '081234567890' })).toHaveCount(0)
  })

  test('the unread badge in the Navbar follows new messages', async () => {
    const a = A.page
    const b = B.page
    // A reopens the thread, then leaves it.
    await a.goto(connectionPath)
    await expect(a.locator('.mc-msg').filter({ hasText: 'Halo juga Alya' })).toBeVisible()
    await a.goto(MATCH)
    await expect(navLink(a)).toHaveAccessibleName('Teman Sekamar')
    await b.getByLabel('Tulis pesan').fill('Kamu masih online?')
    await b.getByLabel('Tulis pesan').press('Enter')
    await expect(b.locator('.mc-msg').filter({ hasText: 'Kamu masih online?' })).toBeVisible()
    await a.reload()
    await expect(navLink(a)).toHaveAccessibleName(/Teman Sekamar \(1 belum dibaca\)/)
    await a.goto(connectionPath)
    await expect(a.locator('.mc-msg').filter({ hasText: 'Kamu masih online?' })).toBeVisible()
    await a.reload()
    await expect(navLink(a)).toHaveAccessibleName('Teman Sekamar')
  })

  // App bug (R3-B8 report, bug 1): a thread opened while still empty never marks a message that arrives by polling as read,
  // because ChatThread's firstRun flag stays true and the stale connection.unread (0) makes the first incoming message look like the
  // initial load. Expected: A reads B's live reply, leaves, and the Navbar badge is gone. Actual: it still says "1 belum dibaca".
  test('a message read live in an open thread clears the Navbar badge after leaving (see .orchestration/reports/R3-B8.md)', async () => {
    const a = A.page
    await a.goto(MATCH)
    await expect(navLink(a)).toHaveAccessibleName('Teman Sekamar')
  })

  test('A adds a candidate kos and B sees who added it', async () => {
    const a = A.page
    const kosPath = connectionPath.replace('/pesan/', '/kos/')
    await a.goto(kosPath)
    await expect(a.getByRole('heading', { name: 'Saran kos untuk kalian' })).toBeVisible()
    const add = a.getByRole('button', { name: 'Tambah', exact: true }).first()
    await expect(add, 'the seeded kos near BINUS offers a shareable room').toBeVisible()
    await add.click()
    await expect(a.getByText('Ditambahkan oleh Kamu')).toBeVisible()

    await B.page.goto(kosPath)
    await expect(B.page.getByText(`Ditambahkan oleh ${nameA}`)).toBeVisible()
  })

  test('A blocks B: B is read-only and A leaves the discover of B', async () => {
    const a = A.page
    const b = B.page
    await a.goto(connectionPath)
    await a.getByRole('button', { name: 'Blokir', exact: true }).click()
    const dialog = a.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Blokir', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await b.goto(connectionPath)
    await expect(b.getByRole('note').filter({ hasText: 'hanya bisa dibaca' })).toBeVisible()
    await expect(b.getByLabel('Tulis pesan')).toHaveCount(0)

    await b.goto(MATCH)
    await expect(b.getByRole('link', { name: new RegExp(nameA) })).toHaveCount(0)
    await expect(b.locator('.mt-page')).not.toContainText(nameA)
    const sent = await trpcRaw(b, 'matching.message.send', { connectionId: connectionId(), body: 'Masih bisa?' })
    expect(sent.status, 'a blocked thread refuses sends').toBeGreaterThanOrEqual(400)
  })

  test('C cannot open the conversation of A and B', async () => {
    const c = C.page
    await fillCore(c, `Cici${Date.now().toString(36)}`)
    await c.goto(connectionPath)
    await expect(c.getByRole('heading', { name: /Percakapan tidak ditemukan|Belum ada koneksi/ })).toBeVisible()
    await expect(c.getByText('Halo Bela, salam kenal!')).toHaveCount(0)
    const raw = await trpcRaw(c, 'matching.message.send', { connectionId: connectionId(), body: 'Halo' })
    expect(raw.status, 'a stranger cannot post into the thread').toBeGreaterThanOrEqual(400)
    // Deliberate refusals show up as browser console errors.
    expectHttpErrors(problems.B, 400, 403, 404, 405)
    expectHttpErrors(problems.C, 400, 403, 404, 405)
  })
})

test('an unverified student gets the verify CTA', async ({ page, problems }) => {
  await ownIp(page)
  await signUpVerified(page, 'mt-unverified')
  await page.goto(MATCH)
  await expect(page.getByRole('heading', { name: 'Verifikasi status mahasiswa dulu' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verifikasi status mahasiswa' })).toHaveAttribute('href', '/profile')
  expectHttpErrors(problems, 403)
})

test('a signed-out visitor gets the login CTA', async ({ page, problems }) => {
  await page.goto(MATCH)
  await expect(page.getByRole('heading', { name: 'Masuk untuk mencari teman sekamar' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Masuk atau daftar' })).toHaveAttribute('href', /\/masuk\?next=/)
  expectHttpErrors(problems, 401)
})
