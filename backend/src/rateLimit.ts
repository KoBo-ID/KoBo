import { TRPCError } from '@trpc/server'

/**
 * Fixed-window counter in memory (one container, like better-auth's limiter): it resets on restart, which is fine for
 * abuse control and not for anything that must be exact. Keys are `<bucket>:<user or ip>`.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly opts: { enabled?: boolean; now?: () => number }
  constructor(opts: { enabled?: boolean; now?: () => number } = {}) {
    this.opts = opts
  }

  /** Throws TOO_MANY_REQUESTS once `key` has been used `max` times inside `windowMs`. */
  check(key: string, max: number, windowMs: number, message = 'Terlalu banyak permintaan. Coba lagi nanti.'): void {
    if (this.opts.enabled === false) return
    const now = (this.opts.now ?? Date.now)()
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      this.hits.set(key, recent)
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message })
    }
    recent.push(now)
    this.hits.set(key, recent)
    // Keep the map from growing without bound: drop keys that have gone quiet.
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k)
  }
}

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

/** The shared limiter. Off under vitest (NODE_ENV=test), where one process runs hundreds of cases as the same seeded users. */
export const limiter = new RateLimiter({ enabled: process.env.NODE_ENV !== 'test' })

/** The limiter a request uses: the one injected into the context (tests), else the shared one. */
export const limiterFor = (ctx: { limiter?: RateLimiter }): RateLimiter => ctx.limiter ?? limiter
