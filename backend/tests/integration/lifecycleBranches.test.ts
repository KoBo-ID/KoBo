// A-014: lifecycle error branches and operator CLIs that had no test.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import type { PaymentProvider } from '../../src/payment/provider.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const errorFrom = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

/** Run a backend script against the test database, like `npm run <script> -w backend -- args`. */
function runScript(script: string, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', `scripts/${script}`, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const xendit = (createCheckout: PaymentProvider['createCheckout']) => {
  const provider: PaymentProvider = { kind: 'XENDIT', createCheckout, getSession: vi.fn(), createRefund: vi.fn() }
  return new PaymentService({ defaultProvider: provider })
}
const session = (checkoutUrl: string | null) => ({
  providerSessionId: 'ps_x',
  providerPaymentRequestId: 'pr_x',
  providerBusinessId: 'biz_1',
  checkoutUrl,
  expiresAt: new Date(Date.now() + 25 * 60_000),
})

async function fixture() {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id)
  return { student, invoiceId: approved.invoiceId }
}

describe('payment.start provider branches', () => {
  it.each([['http://checkout.example/insecure'], [null]])('fails the attempt with INVALID_CHECKOUT_URL when the provider returns %s', async (url) => {
    const { student, invoiceId } = await fixture()
    const service = xendit(vi.fn().mockResolvedValue(session(url as string | null)) as never)
    const e = await errorFrom(callerFor(student.id, { paymentService: service }).payment.start({ invoiceId }))
    expect(e?.code).toBe('BAD_GATEWAY')
    expect(await prisma.payment.findFirstOrThrow({ where: { invoiceId } })).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_CHECKOUT_URL' })
  })

  it('fails the attempt with PROVIDER_ERROR on a non-Xendit exception, without leaking its text', async () => {
    const { student, invoiceId } = await fixture()
    const service = xendit(vi.fn().mockRejectedValue(new Error('socket exploded: secret-detail')))
    const e = await errorFrom(callerFor(student.id, { paymentService: service }).payment.start({ invoiceId }))
    expect(e?.code).toBe('BAD_GATEWAY')
    expect(e?.message).not.toContain('secret-detail')
    expect(await prisma.payment.findFirstOrThrow({ where: { invoiceId } })).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_ERROR' })
    // The failed attempt frees the invoice: a retry opens a new attempt.
    const retry = xendit(vi.fn().mockResolvedValue(session('https://checkout.xendit.co/web/ps_ok')) as never)
    expect((await callerFor(student.id, { paymentService: retry }).payment.start({ invoiceId })).kind).toBe('REDIRECT')
  })
})

describe('places:approve reject path (OwnerPlace)', () => {
  it('rejects a pending place, keeps it off the public snapshot, and refuses a second decision', async () => {
    const kos = await prisma.kos.findFirstOrThrow({ orderBy: { id: 'asc' } })
    const row = await prisma.ownerPlace.create({ data: { kosId: kos.id, name: 'Warung Ditolak', category: 'food', lat: kos.lat, lng: kos.lng } })
    expect(row.status).toBe('pending')

    const listed = runScript('approve-places.ts', ['list'])
    expect(listed.status).toBe(0)
    expect(listed.out).toContain(row.id)

    const rejected = runScript('approve-places.ts', ['reject', row.id])
    expect(rejected.status).toBe(0)
    expect(rejected.out).toContain('Ditolak')
    expect(await prisma.ownerPlace.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'rejected' })
    expect(await prisma.kosPlace.count({ where: { kosId: kos.id, placeId: row.id } })).toBe(0)

    const again = runScript('approve-places.ts', ['approve', row.id])
    expect(again.status).toBe(1)
    expect((await prisma.ownerPlace.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('rejected')
    expect(runScript('approve-places.ts', ['reject', 'no-such-id']).status).toBe(1)
    expect(runScript('approve-places.ts', ['bogus']).status).toBe(2)
  })
})

describe('owners:approve CLI', () => {
  const unapprovedOwner = async (email: string) => {
    const user = await prisma.user.create({ data: { id: `cli-owner-${email}`, name: 'Pemilik CLI', email, emailVerified: true } })
    return prisma.ownerProfile.create({ data: { userId: user.id } })
  }

  it('lists, approves (case-insensitive email), reports a repeat as nothing to approve, and revokes', async () => {
    const owner = await unapprovedOwner('cli-owner@kobo.test')

    const listed = runScript('approve-owner.ts', ['list'])
    expect(listed.status).toBe(0)
    expect(listed.out).toContain('cli-owner@kobo.test')

    const approved = runScript('approve-owner.ts', ['CLI-Owner@kobo.test'])
    expect(approved.out).toContain('Approved')
    expect((await prisma.ownerProfile.findUniqueOrThrow({ where: { id: owner.id } })).approvedAt).not.toBeNull()
    expect(runScript('approve-owner.ts', ['cli-owner@kobo.test']).out).toContain('Nothing to approve')

    const revoked = runScript('approve-owner.ts', ['revoke', 'cli-owner@kobo.test'])
    expect(revoked.out).toContain('Hidden')
    expect((await prisma.ownerProfile.findUniqueOrThrow({ where: { id: owner.id } })).approvedAt).toBeNull()
    expect(runScript('approve-owner.ts', ['revoke', 'nobody@kobo.test']).out).toContain('No owner with email')
  })

  it('exits 2 with usage on bad arguments', () => {
    const r = runScript('approve-owner.ts', [])
    expect(r.status).toBe(2)
    expect(r.out).toContain('Usage')
  })
})

