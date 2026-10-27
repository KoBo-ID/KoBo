/** Stops a periodic worker: no new ticks, and resolves once the tick that is running (if any) has finished. */
export type StopWorker = () => Promise<void>

/**
 * Runs `job` every `intervalMs`. Ticks never overlap inside this process, a failing tick is logged and the next one still
 * runs, and the returned stop function lets shutdown wait for work in flight instead of cutting it off mid-write.
 */
export function startPeriodic(name: string, intervalMs: number, job: () => Promise<unknown>): StopWorker {
  let running: Promise<void> | null = null
  const tick = () => {
    if (running) return
    running = job()
      .then(() => undefined)
      .catch((err) => console.error(`[${name}] failed:`, err instanceof Error ? err.message : err))
      .finally(() => {
        running = null
      })
  }
  const timer = setInterval(tick, intervalMs)
  return async () => {
    clearInterval(timer)
    await running
  }
}
