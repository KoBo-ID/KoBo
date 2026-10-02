import { describe, expect, it } from 'vitest'
import { competes, matchOffers, queuePosition } from './waitlist.ts'

const e = (id: string, roomType: string | null, t: number) => ({ id, roomType, createdAt: new Date(t) })

describe('competes', () => {
  it('is true when either side is any type or both are equal', () => {
    expect(competes(null, 'Deluxe')).toBe(true)
    expect(competes('Deluxe', null)).toBe(true)
    expect(competes(null, null)).toBe(true)
    expect(competes('Deluxe', 'Deluxe')).toBe(true)
    expect(competes('Deluxe', 'Standar')).toBe(false)
  })
})

describe('queuePosition', () => {
  const queue = [e('a', 'Deluxe', 1), e('b', 'Standar', 2), e('c', null, 3), e('d', 'Deluxe', 4), e('e', 'Standar', 5)]
  it('counts only earlier competing entries', () => {
    expect(queuePosition(queue[0], queue)).toBe(1)
    expect(queuePosition(queue[1], queue)).toBe(1) // a is Deluxe, no competition
    expect(queuePosition(queue[2], queue)).toBe(3) // any type: behind a and b
    expect(queuePosition(queue[3], queue)).toBe(3) // behind a and c
    expect(queuePosition(queue[4], queue)).toBe(3) // behind b and c
  })
  it('breaks ties on id', () => {
    const tied = [e('y', null, 1), e('x', null, 1)]
    expect(queuePosition(tied[0], tied)).toBe(2)
    expect(queuePosition(tied[1], tied)).toBe(1)
  })
  it('goes down when an earlier entry leaves', () => {
    expect(queuePosition(queue[3], queue.filter((q) => q.id !== 'a'))).toBe(2)
  })
  it('works without the entry in the list and with ISO strings', () => {
    expect(queuePosition({ id: 'z', roomType: null, createdAt: new Date(9).toISOString() }, queue)).toBe(6)
  })
})

describe('matchOffers', () => {
  const rooms = [
    { id: 'r1', type: 'Standar' },
    { id: 'r2', type: 'Deluxe' },
  ]
  it('skips entries whose type has no free room', () => {
    expect(matchOffers([e('a', 'Deluxe', 1), e('b', 'Standar', 2)], [rooms[0]])).toEqual([{ entryId: 'b', roomId: 'r1' }])
  })
  it('gives any-type entries the first free room and uses each room once', () => {
    expect(matchOffers([e('a', null, 1), e('b', null, 2), e('c', null, 3)], rooms)).toEqual([
      { entryId: 'a', roomId: 'r1' },
      { entryId: 'b', roomId: 'r2' },
    ])
  })
  it('respects queue order for the same room', () => {
    expect(matchOffers([e('a', 'Standar', 1), e('b', null, 2)], rooms)).toEqual([
      { entryId: 'a', roomId: 'r1' },
      { entryId: 'b', roomId: 'r2' },
    ])
  })
  it('returns nothing without free rooms or entries', () => {
    expect(matchOffers([e('a', null, 1)], [])).toEqual([])
    expect(matchOffers([], rooms)).toEqual([])
  })
})
