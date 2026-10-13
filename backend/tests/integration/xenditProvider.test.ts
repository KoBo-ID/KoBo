import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_XENDIT_CHECKOUT_WINDOW_MS, XenditError, XenditPaymentProvider } from '../../src/payment/xendit.ts'

const secretApiKey = 'xnd_development_test-secret'
const businessId = 'business-master'
const apiBaseUrl = 'https://api.xendit.test'
const now = new Date('2026-10-13T11:30:00.000Z')

const session = (overrides: Record<string, unknown> = {}) => ({
  payment_session_id: 'ps-661f87c614802d6c402cd82d',
  reference_id: 'payment-123',
  status: 'ACTIVE',
  amount: 1_250_000,
  currency: 'IDR',
  expires_at: '2026-10-13T12:00:00.000Z',
  payment_link_url: 'https://checkout-staging.xendit.co/sessions/ps-661f87c614802d6c402cd82d',
  payment_request_id: null,
  payment_id: null,
  business_id: businessId,
  updated: '2026-10-13T11:30:00.000Z',
  ...overrides,
})

const createInput = {
  paymentId: 'payment-123',
  amount: 1_250_000,
  currency: 'IDR' as const,
  expiresAt: new Date('2026-10-13T12:00:00.000Z'),
  successReturnUrl: 'https://kobo.test/my-kos?payment=payment-123',
  failureReturnUrl: 'https://kobo.test/my-kos?payment=payment-123',
  providerBusinessId: 'business-owner',
  splitRuleId: 'split-rule-123',
}

const makeProvider = (fetch: typeof globalThis.fetch) =>
  new XenditPaymentProvider({ secretApiKey, businessId, apiBaseUrl, fetch, now: () => now })

afterEach(() => vi.useRealTimers())

describe('XenditPaymentProvider', () => {
  it('creates an Indonesian hosted checkout using Basic auth and XenPlatform headers', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(session({ business_id: createInput.providerBusinessId }), { status: 201 }),
    )
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await expect(provider.createCheckout(createInput)).resolves.toEqual({
      providerSessionId: 'ps-661f87c614802d6c402cd82d',
      providerPaymentRequestId: null,
      providerBusinessId: createInput.providerBusinessId,
      checkoutUrl: 'https://checkout-staging.xendit.co/sessions/ps-661f87c614802d6c402cd82d',
      expiresAt: createInput.expiresAt,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(url).toBe(`${apiBaseUrl}/sessions`)
    expect(init.method).toBe('POST')
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`${secretApiKey}:`).toString('base64')}`)
    expect(headers.get('for-user-id')).toBe(createInput.providerBusinessId)
    expect(headers.get('with-split-rule')).toBe(createInput.splitRuleId)
    expect(body).toMatchObject({
      reference_id: createInput.paymentId,
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      capture_method: 'AUTOMATIC',
      allow_save_payment_method: 'DISABLED',
      amount: createInput.amount,
      currency: 'IDR',
      country: 'ID',
      expires_at: createInput.expiresAt.toISOString(),
      success_return_url: createInput.successReturnUrl,
      cancel_return_url: createInput.failureReturnUrl,
    })
    expect(body).not.toHaveProperty('customer')
    expect(body).not.toHaveProperty('customer_id')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits XenPlatform headers when no subaccount or split rule is requested', async () => {
    const fetchMock = vi.fn(async () => Response.json(session(), { status: 201 }))
    const { providerBusinessId: _providerBusinessId, splitRuleId: _splitRuleId, ...input } = createInput

    await makeProvider(fetchMock as unknown as typeof fetch).createCheckout(input)

    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    expect(headers.has('for-user-id')).toBe(false)
    expect(headers.has('with-split-rule')).toBe(false)
  })

  it('omits customer identity for separate attempts and subaccounts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session({ business_id: 'business-owner-a' }), { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          session({ payment_session_id: 'ps-761f87c614802d6c402cd82e', reference_id: 'payment-456', business_id: 'business-owner-b' }),
          { status: 201 },
        ),
      )
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await provider.createCheckout({ ...createInput, providerBusinessId: 'business-owner-a' })
    await provider.createCheckout({ ...createInput, paymentId: 'payment-456', providerBusinessId: 'business-owner-b' })

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>)
    expect(bodies.map((body) => body.reference_id)).toEqual(['payment-123', 'payment-456'])
    expect(bodies.every((body) => !('customer' in body) && !('customer_id' in body))).toBe(true)
  })

  it('rejects checkout windows shorter than 11 minutes before making a request', async () => {
    const fetchMock = vi.fn()
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await expect(
      provider.createCheckout({ ...createInput, expiresAt: new Date(now.getTime() + MIN_XENDIT_CHECKOUT_WINDOW_MS - 1) }),
    ).rejects.toMatchObject({ operation: 'CREATE_SESSION', code: 'INVALID_REQUEST', outcomeUnknown: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts exactly the 11-minute checkout boundary', async () => {
    const expiresAt = new Date(now.getTime() + MIN_XENDIT_CHECKOUT_WINDOW_MS)
    const fetchMock = vi.fn(async () =>
      Response.json(session({ business_id: createInput.providerBusinessId, expires_at: expiresAt.toISOString() }), { status: 201 }),
    )

    await expect(makeProvider(fetchMock as unknown as typeof fetch).createCheckout({ ...createInput, expiresAt })).resolves.toMatchObject({ expiresAt })
  })

  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['COMPLETED', 'COMPLETED'],
    ['EXPIRED', 'EXPIRED'],
    ['CANCELED', 'FAILED'],
  ] as const)('normalizes a %s session as %s', async (providerStatus, state) => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        session({
          status: providerStatus,
          payment_request_id: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
          payment_id: 'py-ac1fcd3e-21c5-4c70-bb06-fa3c34e19e0c',
        }),
      ),
    )

    await expect(
      makeProvider(fetchMock as unknown as typeof fetch).getSession({ providerSessionId: 'ps-661f87c614802d6c402cd82d' }),
    ).resolves.toEqual({
      state,
      referenceId: 'payment-123',
      providerSessionId: 'ps-661f87c614802d6c402cd82d',
      providerPaymentRequestId: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
      providerPaymentId: 'py-ac1fcd3e-21c5-4c70-bb06-fa3c34e19e0c',
      providerBusinessId: businessId,
      amount: 1_250_000,
      currency: 'IDR',
      updatedAt: new Date('2026-10-13T11:30:00.000Z'),
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${apiBaseUrl}/sessions/ps-661f87c614802d6c402cd82d`)
    expect(init.method).toBe('GET')
  })

  it('rejects a provider expiry later than KoBo\'s tenancy hold', async () => {
    const fetchMock = vi.fn(async () => Response.json(session({ expires_at: '2026-10-13T12:00:01.000Z' }), { status: 201 }))
    const { providerBusinessId: _providerBusinessId, splitRuleId: _splitRuleId, ...input } = createInput

    await expect(makeProvider(fetchMock as unknown as typeof fetch).createCheckout(input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      retryable: false,
    })
  })

  it('rejects checkout links outside documented Xendit hosts', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(session({ payment_link_url: 'https://attacker.example/collect' }), { status: 201 }),
    )
    const { providerBusinessId: _providerBusinessId, splitRuleId: _splitRuleId, ...input } = createInput

    await expect(makeProvider(fetchMock as unknown as typeof fetch).createCheckout(input)).rejects.toMatchObject({
      operation: 'CREATE_SESSION',
      code: 'INVALID_RESPONSE',
      retryable: false,
      outcomeUnknown: true,
    })
  })

  it('submits a full refund with the stable KoBo reference and an allowed reason', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: 'rfd-69e77490-d2cc-4bf3-8319-e064e121db93',
        reference_id: 'refund-payment-123',
        payment_request_id: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
        currency: 'IDR',
        amount: 1_250_000,
        status: 'PENDING',
        updated: '2026-10-13T11:45:00.000Z',
      }),
    )
    const provider = makeProvider(fetchMock as unknown as typeof fetch)

    await expect(
      provider.createRefund({
        referenceId: 'refund-payment-123',
        providerPaymentRequestId: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
        providerBusinessId: 'business-owner',
        amount: 1_250_000,
        currency: 'IDR',
        reason: 'CANCELLATION',
      }),
    ).resolves.toEqual({
      providerRefundId: 'rfd-69e77490-d2cc-4bf3-8319-e064e121db93',
      state: 'PENDING',
      updatedAt: new Date('2026-10-13T11:45:00.000Z'),
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${apiBaseUrl}/refunds`)
    expect(new Headers(init.headers).get('for-user-id')).toBe('business-owner')
    expect(JSON.parse(init.body as string)).toEqual({
      reference_id: 'refund-payment-123',
      payment_request_id: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
      currency: 'IDR',
      amount: 1_250_000,
      reason: 'CANCELLATION',
    })
  })

  it.each([
    ['payment_session_id', { payment_session_id: '' }],
    ['payment_link_url', { payment_link_url: 'http://xen.to/a' }],
    ['business_id', { business_id: '' }],
    ['expires_at', { expires_at: 'not-a-date' }],
    ['reference_id', { reference_id: 'wrong-payment' }],
    ['amount', { amount: 1 }],
    ['currency', { currency: 'USD' }],
    ['status', { status: 'COMPLETED' }],
  ])('fails closed when a successful create Session response mismatches %s', async (_field, override) => {
    const fetchMock = vi.fn(async () => Response.json(session(override), { status: 201 }))
    const { providerBusinessId: _providerBusinessId, splitRuleId: _splitRuleId, ...input } = createInput
    await expect(makeProvider(fetchMock as unknown as typeof fetch).createCheckout(input)).rejects.toMatchObject({
      operation: 'CREATE_SESSION',
      code: 'INVALID_RESPONSE',
      retryable: false,
      outcomeUnknown: true,
    })
  })

  it('rejects a GET Session response for a different session ID', async () => {
    const fetchMock = vi.fn(async () => Response.json(session({ payment_session_id: 'ps-761f87c614802d6c402cd82e' })))

    await expect(
      makeProvider(fetchMock as unknown as typeof fetch).getSession({ providerSessionId: 'ps-661f87c614802d6c402cd82d' }),
    ).rejects.toMatchObject({ operation: 'GET_SESSION', code: 'INVALID_RESPONSE', outcomeUnknown: false })
  })

  it.each([
    ['reference_id', { reference_id: 'wrong-refund' }],
    ['payment_request_id', { payment_request_id: 'pr-wrong' }],
    ['currency', { currency: 'USD' }],
    ['amount', { amount: 1 }],
  ])('rejects a successful refund response that mismatches %s', async (_field, override) => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: 'rfd-69e77490-d2cc-4bf3-8319-e064e121db93',
        reference_id: 'refund-payment-123',
        payment_request_id: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
        currency: 'IDR',
        amount: 1_250_000,
        status: 'PENDING',
        updated: '2026-10-13T11:45:00.000Z',
        ...override,
      }),
    )

    await expect(
      makeProvider(fetchMock as unknown as typeof fetch).createRefund({
        referenceId: 'refund-payment-123',
        providerPaymentRequestId: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
        amount: 1_250_000,
        currency: 'IDR',
        reason: 'CANCELLATION',
      }),
    ).rejects.toMatchObject({ operation: 'CREATE_REFUND', code: 'INVALID_RESPONSE', outcomeUnknown: true })
  })

  it.each([
    [400, false],
    [401, false],
    [409, false],
    [429, true],
    [500, true],
    [503, true],
  ])('classifies HTTP %i retryability and exposes no raw provider message', async (status, retryable) => {
    const providerMessage = `${secretApiKey} customer@example.com ${'x'.repeat(500)}`
    const fetchMock = vi.fn(async () =>
      Response.json({ error_code: 'PROVIDER_CODE', message: providerMessage }, { status }),
    )
    const error = await makeProvider(fetchMock as unknown as typeof fetch)
      .getSession({ providerSessionId: 'ps-661f87c614802d6c402cd82d' })
      .then(() => null, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(XenditError)
    expect(error).toMatchObject({ operation: 'GET_SESSION', status, code: 'PROVIDER_CODE', retryable, outcomeUnknown: false })
    expect((error as Error).message.length).toBeLessThanOrEqual(200)
    expect((error as Error).message).not.toContain(secretApiKey)
    expect((error as Error).message).not.toContain('customer@example.com')
  })

  it('aborts requests after 15 seconds and marks the timeout retryable', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const pending = makeProvider(fetchMock as unknown as typeof fetch).getSession({
      providerSessionId: 'ps-661f87c614802d6c402cd82d',
    })
    const rejection = expect(pending).rejects.toMatchObject({
      operation: 'GET_SESSION',
      status: null,
      code: 'TIMEOUT',
      retryable: true,
      outcomeUnknown: false,
    })

    await vi.advanceTimersByTimeAsync(14_999)
    expect(vi.mocked(fetchMock).mock.settledResults[0]?.type).toBe('incomplete')
    await vi.advanceTimersByTimeAsync(1)
    await rejection
  })

  it.each([
    ['CREATE_SESSION', () => makeProvider((async () => Promise.reject(new Error('socket reset'))) as typeof fetch).createCheckout(createInput)],
    [
      'CREATE_REFUND',
      () =>
        makeProvider((async () => Promise.reject(new Error('socket reset'))) as typeof fetch).createRefund({
          referenceId: 'refund-payment-123',
          providerPaymentRequestId: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
          amount: 1_250_000,
          currency: 'IDR',
          reason: 'CANCELLATION',
        }),
    ],
  ] as const)('marks an ambiguous %s network failure for reconciliation instead of blind retry', async (operation, invoke) => {
    await expect(invoke()).rejects.toMatchObject({
      operation,
      status: null,
      code: 'NETWORK_ERROR',
      retryable: false,
      outcomeUnknown: true,
    })
  })

  it.each([
    [500, 'SERVER_ERROR'],
    [503, 'TEMPORARY_SERVER_ERROR'],
  ])('marks a create Session HTTP %i as outcome unknown', async (status, code) => {
    const fetchMock = vi.fn(async () => Response.json({ error_code: code }, { status }))

    await expect(makeProvider(fetchMock as unknown as typeof fetch).createCheckout(createInput)).rejects.toMatchObject({
      operation: 'CREATE_SESSION',
      status,
      code,
      retryable: false,
      outcomeUnknown: true,
    })
  })

  it.each([
    ['TEMPORARILY_UNAVAILABLE', true, false],
    ['REFUND_IN_PROGRESS', false, true],
    ['INSUFFICIENT_BALANCE', false, false],
  ])('classifies refund error %s safely', async (code, retryable, outcomeUnknown) => {
    const fetchMock = vi.fn(async () => Response.json({ error_code: code }, { status: 400 }))

    await expect(
      makeProvider(fetchMock as unknown as typeof fetch).createRefund({
        referenceId: 'refund-payment-123',
        providerPaymentRequestId: 'pr-0800fe40-bb79-47ae-9d1e-e69394d3949c',
        amount: 1_250_000,
        currency: 'IDR',
        reason: 'CANCELLATION',
      }),
    ).rejects.toMatchObject({ operation: 'CREATE_REFUND', status: 400, code, retryable, outcomeUnknown })
  })

  it('validates the API base URL independently of environment parsing', () => {
    expect(
      () => new XenditPaymentProvider({ secretApiKey, businessId, apiBaseUrl: 'http://api.xendit.test', fetch: vi.fn() as unknown as typeof fetch }),
    ).toThrow(/HTTPS origin/)
    expect(
      () => new XenditPaymentProvider({ secretApiKey, businessId, apiBaseUrl: 'https://api.xendit.test/v1', fetch: vi.fn() as unknown as typeof fetch }),
    ).toThrow(/HTTPS origin/)
    expect(
      new XenditPaymentProvider({ secretApiKey, businessId, apiBaseUrl: 'http://127.0.0.1:9999', fetch: vi.fn() as unknown as typeof fetch }).kind,
    ).toBe('XENDIT')
  })
})
