/** A live offer lasts this long (same as the booking hold, HOLD_HOURS). */
export const OFFER_HOURS = 24
/** Live (WAITING or OFFERED) entries one student may hold across all kos. */
export const MAX_LIVE_ENTRIES = 5

export interface QueueEntry {
  id: string
  /** null = any room type */
  roomType: string | null
  createdAt: Date | string
}

export interface FreeRoom {
  id: string
  type: string
}

/** Two preferences compete when either is "any type" (null) or both name the same type. */
export function competes(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b
}

const at = (e: QueueEntry) => new Date(e.createdAt).getTime()

/** FIFO order: join time, then id as the tie-break. */
export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  return at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** 1 + the WAITING entries ahead of `entry` that compete with it. `waiting` may include `entry` itself. */
export function queuePosition(entry: QueueEntry, waiting: QueueEntry[]): number {
  return 1 + waiting.filter((o) => o.id !== entry.id && competes(o.roomType, entry.roomType) && compareQueue(o, entry) < 0).length
}

/**
 * Walk the queue (already in FIFO order) and give each entry the first free room of its type; a room is used
 * once. `freeRooms` must already be in the order rooms should be handed out (by room number).
 */
export function matchOffers(waitingInOrder: QueueEntry[], freeRooms: FreeRoom[]): { entryId: string; roomId: string }[] {
  const free = [...freeRooms]
  const offers: { entryId: string; roomId: string }[] = []
  for (const entry of waitingInOrder) {
    if (free.length === 0) break
    const i = free.findIndex((r) => entry.roomType === null || r.type === entry.roomType)
    if (i === -1) continue
    offers.push({ entryId: entry.id, roomId: free[i].id })
    free.splice(i, 1)
  }
  return offers
}
