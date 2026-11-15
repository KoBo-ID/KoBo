import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { consoleTransport, drainOutbox, enqueueEmail, resendTransport, transportFromEnv } from '../../src/outbox.ts'
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

describe('templates', () => {
  it.each(['verify-email', 'reset-password'])('%s is a full Indonesian document with title, preheader, plain URL and a text part', (template) => {
    const r = renderEmail(template, payload)!
    expect(r.html).toMatch(/^<!doctype html><html lang="id"><head>/)
    expect(r.html).toContain(`<title>${r.subject}</title>`)
    expect(r.html).toMatch(/<div style="display:none[^"]*">[^<]{10,}<\/div>/)
    expect(r.html.split(payload.url.replace(/&/g, '&amp;')).length - 1).toBe(2) // button href + copy-paste URL
    expect(r.text).toContain(payload.url)
    expect(r.text).not.toContain('<')
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

  it('resend: sends reply_to only when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }))
    const t = resendTransport({ apiKey: 'k', from: 'KoBo <halo@kobo.test>', replyTo: 'tim@kobo.test', fetch: fetchMock as unknown as typeof fetch })
    await t.send({ to: 'a@example.com', subject: 'Halo', html: '<p>hi</p>', text: 'hi' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ reply_to: 'tim@kobo.test', text: 'hi' })
  })

  it('resend: a non-2xx response is a failure, so the row retries', async () => {
    const t = resendTransport({ apiKey: 'k', from: 'f', fetch: (async () => new Response('{"message":"bad"}', { status: 422 })) as unknown as typeof fetch })
    await expect(t.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' })).rejects.toThrow(/422/)
    await expect(t.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' })).rejects.toMatchObject({ status: 422, body: '{"message":"bad"}' })
  })

  it('resend: a 403 (test sender, foreign recipient) retries with backoff, then ends FAILED with a clear log', async () => {
    await queue('mahasiswa@student.binus.ac.id')
    const body = '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address"}'
    const t = resendTransport({ apiKey: 'k', from: 'KoBo <onboarding@resend.dev>', fetch: (async () => new Response(body, { status: 403 })) as unknown as typeof fetch })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (let i = 1; i <= 5; i++) {
        await prisma.emailOutbox.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } })
        expect(await drainOutbox(prisma, t)).toEqual({ claimed: 1, sent: 0, failed: 1 })
        const row = await prisma.emailOutbox.findFirstOrThrow()
        expect(row.attempts).toBe(i)
        expect(row.status).toBe(i < 5 ? 'PENDING' : 'FAILED')
      }
      const row = await prisma.emailOutbox.findFirstOrThrow()
      const last = errors.mock.calls.at(-1)!.join(' ')
      expect(last).toContain(row.id)
      expect(last).toContain('*@student.binus.ac.id')
      expect(last).not.toContain('mahasiswa@')
      expect(last).toContain('403')
      expect(last).toContain('only send testing emails')
      expect(last).toContain('FAILED')
    } finally {
      errors.mockRestore()
    }
  })

  it('transportFromEnv: console without a key, throws without EMAIL_FROM, Resend otherwise', async () => {
    const warnings: string[] = []
    const warn = (l: string) => void warnings.push(l)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await transportFromEnv({}, warn).send({ to: 'a@example.com', subject: 's', html: 'h', text: 'link' })
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
    expect(warnings).toEqual([]) // dev: console is the expected fallback
    expect(() => transportFromEnv({ RESEND_API_KEY: 're_x' }, warn)).toThrow(/EMAIL_FROM/)
    expect(transportFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'KoBo <halo@kobo.id>', NODE_ENV: 'production' }, warn)).toBeTruthy()
    expect(warnings).toEqual([])
  })

  it('transportFromEnv: warns in production about the resend.dev test sender and a missing key', () => {
    const warnings: string[] = []
    const warn = (l: string) => void warnings.push(l)
    transportFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'KoBo <onboarding@resend.dev>', NODE_ENV: 'production' }, warn)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/onboarding@resend\.dev.*test sender/)
    expect(warnings[0]).not.toContain('re_x')
    transportFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'onboarding@resend.dev' }, warn) // dev: no warning
    expect(warnings).toHaveLength(1)
    expect(() => transportFromEnv({ NODE_ENV: 'production' }, warn)).toThrow(/RESEND_API_KEY/) // fail closed: links must not only reach the log
    transportFromEnv({ NODE_ENV: 'production', ALLOW_CONSOLE_EMAIL: '1' }, warn) // explicit e2e/demo opt-in
    expect(warnings[1]).toMatch(/RESEND_API_KEY/)
  })

  it('console: logs the link instead of sending', async () => {
    const lines: string[] = []
    const t = consoleTransport((l) => lines.push(l))
    await t.send({ to: 'a@example.com', subject: 'Halo', html: '', text: 'Buka https://kobo.test/x' })
    expect(lines.join('\n')).toContain('https://kobo.test/x')
    expect(lines.join('\n')).toContain('a@example.com')
  })
})
