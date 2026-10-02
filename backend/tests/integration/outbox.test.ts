import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { consoleTransport, drainOutbox, enqueueEmail, resendTransport } from '../../src/outbox.ts'
import type { EmailMessage, EmailTransport } from '../../src/outbox.ts'
import { prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const payload = { name: 'Sari', url: 'https://kobo.test/api/auth/verify-email?token=abc' }
const queue = (to = 'sari@example.com') => enqueueEmail(prisma, { to, template: 'verify-email', payload })
const recorder = () => {
  const sent: EmailMessage[] = []
  const transport: EmailTransport = { send: async (m) => void sent.push(m) }
  return { sent, transport }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('drainOutbox', () => {
  it('sends a pending row once and marks it SENT', async () => {
    await queue()
    const { sent, transport } = recorder()
    expect(await drainOutbox(prisma, transport)).toEqual({ claimed: 1, sent: 1, failed: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('sari@example.com')
    expect(sent[0].subject).toMatch(/KoBo/)
    expect(sent[0].text).toContain(payload.url)
    expect(sent[0].html).toContain(payload.url)
    const row = await prisma.emailOutbox.findFirstOrThrow()
    expect(row.status).toBe('SENT')
    expect(row.sentAt).not.toBeNull()
    expect(row.attempts).toBe(1)

    expect(await drainOutbox(prisma, transport)).toEqual({ claimed: 0, sent: 0, failed: 0 })
    expect(sent).toHaveLength(1)
  })

  it('claims a row exactly once when two drains race', async () => {
    await queue()
    let sends = 0
    const slow: EmailTransport = {
      send: async () => {
        sends++
        await wait(150) // hold the row mid-send so the drains overlap
      },
    }
    const results = await Promise.all([drainOutbox(prisma, slow), drainOutbox(prisma, slow)])
    expect(sends).toBe(1)
    expect(results.map((r) => r.claimed).sort()).toEqual([0, 1])
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('SENT')
  })

  it('never sends a row twice when several drains split a larger batch', async () => {
    for (let i = 0; i < 10; i++) await queue(`u${i}@example.com`)
    const seen: string[] = []
    const t: EmailTransport = {
      send: async (m) => {
        await wait(20)
        seen.push(m.to)
      },
    }
    await Promise.all([1, 2, 3].map(() => drainOutbox(prisma, t, { batchSize: 4 })))
    await drainOutbox(prisma, t, { batchSize: 10 })
    expect(seen).toHaveLength(10)
    expect(new Set(seen).size).toBe(10)
  })

  it('backs off after a failure and retries once nextAttemptAt passes', async () => {
    await queue()
    const failing: EmailTransport = { send: async () => Promise.reject(new Error('smtp down')) }
    expect(await drainOutbox(prisma, failing)).toEqual({ claimed: 1, sent: 0, failed: 1 })
    let row = await prisma.emailOutbox.findFirstOrThrow()
    expect(row.status).toBe('PENDING')
    expect(row.attempts).toBe(1)
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())

    const { sent, transport } = recorder()
    expect((await drainOutbox(prisma, transport)).claimed).toBe(0) // still backing off
    await prisma.emailOutbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    expect(await drainOutbox(prisma, transport)).toEqual({ claimed: 1, sent: 1, failed: 0 })
    expect(sent).toHaveLength(1)
    row = await prisma.emailOutbox.findFirstOrThrow()
    expect(row.status).toBe('SENT')
    expect(row.attempts).toBe(2)
  })

  it('gives up with status FAILED after the attempt limit', async () => {
    await queue()
    const failing: EmailTransport = { send: async () => Promise.reject(new Error('nope')) }
    for (let i = 0; i < 5; i++) {
      await prisma.emailOutbox.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } })
      await drainOutbox(prisma, failing)
    }
    const row = await prisma.emailOutbox.findFirstOrThrow()
    expect(row.status).toBe('FAILED')
    expect(row.attempts).toBe(5)
    await prisma.emailOutbox.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    expect((await drainOutbox(prisma, failing)).claimed).toBe(0)
  })

  it('marks an unknown template FAILED instead of retrying forever', async () => {
    await prisma.emailOutbox.create({ data: { to: 'a@example.com', template: 'nope', payload: {} } })
    const { sent, transport } = recorder()
    await drainOutbox(prisma, transport)
    expect(sent).toHaveLength(0)
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('FAILED')
  })
})

describe('transports', () => {
  it('resend: posts the message to the Resend HTTP API with a bearer key', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }))
    const t = resendTransport({ apiKey: 're_key', from: 'KoBo <halo@kobo.test>', fetch: fetchMock as unknown as typeof fetch })
    await t.send({ to: 'a@example.com', subject: 'Halo', html: '<p>hi</p>', text: 'hi' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key')
    expect(JSON.parse(init.body as string)).toEqual({ from: 'KoBo <halo@kobo.test>', to: ['a@example.com'], subject: 'Halo', html: '<p>hi</p>', text: 'hi' })
  })

  it('resend: a non-2xx response is a failure, so the row retries', async () => {
    const t = resendTransport({ apiKey: 'k', from: 'f', fetch: (async () => new Response('{"message":"bad"}', { status: 422 })) as unknown as typeof fetch })
    await expect(t.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' })).rejects.toThrow(/422/)
  })

  it('console: logs the link instead of sending', async () => {
    const lines: string[] = []
    const t = consoleTransport((l) => lines.push(l))
    await t.send({ to: 'a@example.com', subject: 'Halo', html: '', text: 'Buka https://kobo.test/x' })
    expect(lines.join('\n')).toContain('https://kobo.test/x')
    expect(lines.join('\n')).toContain('a@example.com')
  })
})
