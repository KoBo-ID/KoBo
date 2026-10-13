import { z } from 'zod'
import type {
  CheckoutSession,
  CreateCheckoutInput,
  CreateRefundInput,
  GetSessionInput,
  PaymentProvider,
  PaymentSessionSnapshot,
  RefundSnapshot,
} from './provider.ts'

const REQUEST_TIMEOUT_MS = 15_000
export const MIN_XENDIT_CHECKOUT_WINDOW_MS = 11 * 60 * 1000
export type XenditOperation = 'CREATE_SESSION' | 'GET_SESSION' | 'CREATE_REFUND'
const REFUND_REASONS = new Set(['FRAUDULENT', 'DUPLICATE', 'REQUESTED_BY_CUSTOMER', 'CANCELLATION', 'OTHERS'])
const CHECKOUT_HOSTS = new Set(['checkout.xendit.co', 'checkout-staging.xendit.co', 'xen.to', 'dev.xen.to'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const isoDate = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)))
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:')
const nullableId = z.string().min(1).nullable().optional()

const createdSessionSchema = z.object({
  payment_session_id: z.string().min(1),
  reference_id: z.string().min(1),
  status: z.literal('ACTIVE'),
  amount: z.number().int().positive(),
  currency: z.literal('IDR'),
  payment_link_url: httpsUrl,
  payment_request_id: nullableId,
  latest_payment_request_id: nullableId,
  business_id: z.string().min(1),
  expires_at: isoDate,
})

const sessionSchema = z.object({
  payment_session_id: z.string().min(1),
  reference_id: z.string().min(1),
  status: z.enum(['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELED']),
  payment_request_id: nullableId,
  latest_payment_request_id: nullableId,
  payment_id: nullableId,
  business_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.literal('IDR'),
  updated: isoDate,
})

const refundSchema = z.object({
  id: z.string().min(1),
  reference_id: z.string().min(1),
  payment_request_id: z.string().min(1),
  currency: z.literal('IDR'),
  amount: z.number().int().positive(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  updated: isoDate,
})

const errorSchema = z.object({ error_code: z.string().optional() })

export class XenditError extends Error {
  constructor(
    readonly operation: XenditOperation,
    readonly status: number | null,
    readonly code: string,
    readonly retryable: boolean,
    readonly outcomeUnknown: boolean,
    message: string,
  ) {
    super(message.slice(0, 200))
    this.name = 'XenditError'
  }
}

export interface XenditPaymentProviderOptions {
  secretApiKey: string
  businessId: string
  apiBaseUrl?: string
  fetch?: typeof globalThis.fetch
  now?: () => Date
}

const safeCode = (value: string | undefined, fallback: string) => {
  const code = value?.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 64)
  return code || fallback
}

const classifyHttpError = (operation: XenditOperation, status: number, code: string) => {
  if (code === 'TEMPORARILY_UNAVAILABLE') return { retryable: true, outcomeUnknown: false }
  if (code === 'REFUND_IN_PROGRESS') return { retryable: false, outcomeUnknown: true }
  if (code === 'INSUFFICIENT_BALANCE') return { retryable: false, outcomeUnknown: false }
  if (operation !== 'GET_SESSION' && (status === 408 || status >= 500)) return { retryable: false, outcomeUnknown: true }
  return { retryable: status === 408 || status === 425 || status === 429 || status >= 500, outcomeUnknown: false }
}

const invalidRequest = (operation: XenditOperation, field: string) =>
  new XenditError(operation, null, 'INVALID_REQUEST', false, false, `Invalid Xendit ${field}`)

const assertHttps = (operation: XenditOperation, value: string, field: string) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidRequest(operation, field)
  }
  if (url.protocol !== 'https:') throw invalidRequest(operation, field)
}

/** Native-fetch adapter for the current Xendit Payment Sessions and Refund REST APIs. */
export class XenditPaymentProvider implements PaymentProvider {
  readonly kind = 'XENDIT' as const
  private readonly apiBaseUrl: string
  private readonly doFetch: typeof globalThis.fetch
  private readonly now: () => Date

  constructor(private readonly options: XenditPaymentProviderOptions) {
    if (!options.secretApiKey || !options.businessId) throw new Error('Xendit credentials are required')
    const apiBaseUrl = new URL(options.apiBaseUrl ?? 'https://api.xendit.co')
    if (
      !['http:', 'https:'].includes(apiBaseUrl.protocol) ||
      (apiBaseUrl.protocol === 'http:' && !LOOPBACK_HOSTS.has(apiBaseUrl.hostname)) ||
      apiBaseUrl.username ||
      apiBaseUrl.password ||
      apiBaseUrl.pathname !== '/' ||
      apiBaseUrl.search ||
      apiBaseUrl.hash
    ) {
      throw new Error('Xendit API base URL must be an HTTPS origin, or an HTTP loopback origin for tests')
    }
    this.apiBaseUrl = apiBaseUrl.origin
    this.doFetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? (() => new Date())
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const operation = 'CREATE_SESSION' as const
    if (!input.paymentId || input.paymentId.length > 64 || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.currency !== 'IDR') {
      throw invalidRequest(operation, 'checkout request')
    }
    assertHttps(operation, input.successReturnUrl, 'success return URL')
    assertHttps(operation, input.failureReturnUrl, 'cancel return URL')
    if (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() - this.now().getTime() < MIN_XENDIT_CHECKOUT_WINDOW_MS) {
      throw invalidRequest(operation, 'checkout expiry')
    }

    const body = await this.request('/sessions', {
      operation,
      method: 'POST',
      providerBusinessId: input.providerBusinessId,
      splitRuleId: input.splitRuleId,
      body: {
        reference_id: input.paymentId,
        session_type: 'PAY',
        mode: 'PAYMENT_LINK',
        capture_method: 'AUTOMATIC',
        allow_save_payment_method: 'DISABLED',
        amount: input.amount,
        currency: 'IDR',
        country: 'ID',
        locale: 'id',
        expires_at: input.expiresAt.toISOString(),
        success_return_url: input.successReturnUrl,
        cancel_return_url: input.failureReturnUrl,
      },
    })
    const parsed = this.parse(createdSessionSchema, body, operation)
    this.assertBusiness(parsed.business_id, input.providerBusinessId, operation)
    if (parsed.reference_id !== input.paymentId || parsed.amount !== input.amount || parsed.currency !== input.currency) {
      throw this.invalidResponse(operation)
    }
    const checkoutUrl = new URL(parsed.payment_link_url)
    if (!CHECKOUT_HOSTS.has(checkoutUrl.hostname.toLowerCase())) throw this.invalidResponse(operation)
    const expiresAt = new Date(parsed.expires_at)
    if (expiresAt > input.expiresAt) throw this.invalidResponse(operation)
    return {
      providerSessionId: parsed.payment_session_id,
      providerPaymentRequestId: parsed.payment_request_id ?? parsed.latest_payment_request_id ?? null,
      providerBusinessId: parsed.business_id,
      checkoutUrl: checkoutUrl.toString(),
      expiresAt,
    }
  }

  async getSession(input: GetSessionInput): Promise<PaymentSessionSnapshot> {
    const operation = 'GET_SESSION' as const
    if (!input.providerSessionId) throw invalidRequest(operation, 'session request')
    const body = await this.request(`/sessions/${encodeURIComponent(input.providerSessionId)}`, {
      operation,
      method: 'GET',
      providerBusinessId: input.providerBusinessId,
    })
    const parsed = this.parse(sessionSchema, body, operation)
    this.assertBusiness(parsed.business_id, input.providerBusinessId, operation)
    if (parsed.payment_session_id !== input.providerSessionId) throw this.invalidResponse(operation)
    const state = parsed.status === 'CANCELED' ? 'FAILED' : parsed.status
    return {
      state,
      referenceId: parsed.reference_id,
      providerSessionId: parsed.payment_session_id,
      providerPaymentRequestId: parsed.payment_request_id ?? parsed.latest_payment_request_id ?? null,
      providerPaymentId: parsed.payment_id ?? null,
      providerBusinessId: parsed.business_id,
      amount: parsed.amount,
      currency: parsed.currency,
      updatedAt: new Date(parsed.updated),
    }
  }

  async createRefund(input: CreateRefundInput): Promise<RefundSnapshot> {
    const operation = 'CREATE_REFUND' as const
    if (
      !input.referenceId ||
      !input.providerPaymentRequestId ||
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0 ||
      input.currency !== 'IDR' ||
      !REFUND_REASONS.has(input.reason)
    ) {
      throw invalidRequest(operation, 'refund request')
    }
    const body = await this.request('/refunds', {
      operation,
      method: 'POST',
      providerBusinessId: input.providerBusinessId,
      body: {
        reference_id: input.referenceId,
        payment_request_id: input.providerPaymentRequestId,
        currency: input.currency,
        amount: input.amount,
        reason: input.reason,
      },
    })
    const parsed = this.parse(refundSchema, body, operation)
    if (
      parsed.reference_id !== input.referenceId ||
      parsed.payment_request_id !== input.providerPaymentRequestId ||
      parsed.currency !== input.currency ||
      parsed.amount !== input.amount
    ) {
      throw this.invalidResponse(operation)
    }
    return {
      providerRefundId: parsed.id,
      state: parsed.status === 'CANCELLED' ? 'FAILED' : parsed.status,
      updatedAt: new Date(parsed.updated),
    }
  }

  private invalidResponse(operation: XenditOperation) {
    return new XenditError(operation, null, 'INVALID_RESPONSE', false, operation !== 'GET_SESSION', 'Xendit returned an invalid response')
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown, operation: XenditOperation): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw this.invalidResponse(operation)
    return parsed.data
  }

  private assertBusiness(actual: string, requested: string | undefined, operation: XenditOperation) {
    if (actual !== (requested ?? this.options.businessId)) {
      throw this.invalidResponse(operation)
    }
  }

  private async request(
    path: string,
    input: { operation: XenditOperation; method: 'GET' | 'POST'; providerBusinessId?: string; splitRuleId?: string; body?: Record<string, unknown> },
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${this.options.secretApiKey}:`).toString('base64')}`,
    })
    if (input.body) headers.set('Content-Type', 'application/json')
    if (input.providerBusinessId) headers.set('for-user-id', input.providerBusinessId)
    if (input.splitRuleId) headers.set('with-split-rule', input.splitRuleId)

    try {
      const response = await this.doFetch(`${this.apiBaseUrl}${path}`, {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      })
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) {
        const providerError = errorSchema.safeParse(body)
        const code = safeCode(providerError.success ? providerError.data.error_code : undefined, `HTTP_${response.status}`)
        const classification = classifyHttpError(input.operation, response.status, code)
        throw new XenditError(input.operation, response.status, code, classification.retryable, classification.outcomeUnknown, `Xendit request failed (${code})`)
      }
      return body
    } catch (error) {
      if (error instanceof XenditError) throw error
      const timedOut = controller.signal.aborted
      const outcomeUnknown = input.operation !== 'GET_SESSION'
      throw new XenditError(
        input.operation,
        null,
        timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        !outcomeUnknown,
        outcomeUnknown,
        timedOut ? 'Xendit request timed out' : 'Xendit network request failed',
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}
