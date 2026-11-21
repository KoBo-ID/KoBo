import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  ageBand,
  anchorDistanceKm,
  budgetFraction,
  containsContactInfo,
  hardFilter,
  LIFESTYLE_KEYS,
  LIFESTYLE_VALUES,
  lifestyleFieldScore,
  matchBand,
  matchScore,
  type LifestyleKey,
  type MatchInput,
} from './matching.ts'

const ANGGREK = { lat: -6.2017, lng: 106.7826 }
/** One degree of latitude in km, close enough: the tests assert on the rounded result. */
const KM_PER_DEG = 111.195

const bebas = { sleep: 'BEBAS', tidiness: 'BEBAS', smoking: 'BEBAS', guests: 'BEBAS', noise: 'BEBAS', social: 'BEBAS', study: 'BEBAS', ac: 'BEBAS', expenses: 'BEBAS' } as const

const base: MatchInput = {
  gender: 'LAKI_LAKI',
  ...bebas,
  budgetMin: 1_000_000,
  budgetMax: 1_600_000,
  anchorLat: ANGGREK.lat,
  anchorLng: ANGGREK.lng,
  radiusKm: 3,
  moveInDate: '2026-02-01',
  durationMonths: 6,
  kosType: 'PUTRA',
  roomShare: 2,
}
const person = (over: Partial<MatchInput> = {}): MatchInput => ({ ...base, gender: 'LAKI_LAKI', ...over })

describe('matchScore: worked example (MATCHING-DESIGN section 2)', () => {
  const a = person({
    budgetMin: 1_000_000, budgetMax: 1_600_000, radiusKm: 3, moveInDate: '2026-02-01', durationMonths: 6,
    sleep: 'NORMAL', tidiness: 'RAPI', smoking: 'TIDAK_MEROKOK_TOLERAN', guests: 'BEBAS', noise: 'BEBAS', social: 'SEIMBANG', study: 'DI_KAMAR', ac: 'SELALU', expenses: 'BEBAS',
  })
  const b = person({
    budgetMin: 1_200_000, budgetMax: 2_000_000, radiusKm: 5, moveInDate: '2026-02-15', durationMonths: 12,
    anchorLat: ANGGREK.lat + 1.5 / KM_PER_DEG,
    sleep: 'NORMAL', tidiness: 'CUKUP', smoking: 'TIDAK_MEROKOK_TOLERAN', guests: 'JARANG', noise: 'TENANG', social: 'SEIMBANG', study: 'CAMPUR', ac: 'SELALU', expenses: 'PATUNGAN',
  })

  it('totals 58 and the parts add up to it', () => {
    expect(hardFilter(a, b)).toBeNull()
    const r = matchScore(a, b)
    expect(r.score).toBe(58)
    expect(r.parts.map((p) => p.key)).toEqual(['budget', 'location', 'moveIn', 'duration', 'lifestyle', 'room'])
    expect(r.parts.reduce((s, p) => s + p.points, 0)).toBe(58)
    expect(r.parts.map((p) => p.max)).toEqual([30, 25, 15, 10, 15, 5])
    expect(r.parts.map((p) => p.points)).toEqual([12, 13, 11, 5, 12, 5])
    expect(r.approximate).toBe(false)
    expect(r.parts.every((p) => p.reason.length > 0)).toBe(true)
  })
  it('is the same from the other side', () => {
    expect(matchScore(b, a)).toEqual(matchScore(a, b))
  })
})

describe('budget (F1 edge vectors)', () => {
  const r = (min: number, max: number) => ({ budgetMin: min, budgetMax: max })
  it('two equal points pass and score 1', () => {
    expect(hardFilter(person(r(1_500_000, 1_500_000)), person(r(1_500_000, 1_500_000)))).toBeNull()
    expect(budgetFraction(r(1_500_000, 1_500_000), r(1_500_000, 1_500_000))).toBe(1)
  })
  it('touching ranges pass (overlap 0, floored to Rp 100k)', () => {
    expect(hardFilter(person(r(1_000_000, 1_500_000)), person(r(1_500_000, 2_000_000)))).toBeNull()
    expect(budgetFraction(r(1_000_000, 1_500_000), r(1_500_000, 2_000_000))).toBeCloseTo(100_000 / 1_000_000, 10)
  })
  it('a point inside a range passes', () => {
    expect(hardFilter(person(r(1_200_000, 1_200_000)), person(r(1_000_000, 2_000_000)))).toBeNull()
    expect(budgetFraction(r(1_200_000, 1_200_000), r(1_000_000, 2_000_000))).toBeCloseTo(0.1, 10)
  })
  it('disjoint ranges are refused', () => {
    expect(hardFilter(person(r(1_000_000, 1_400_000)), person(r(1_500_000, 2_000_000)))).toBe('BUDGET')
  })
})

describe('location edge vectors', () => {
  it('radius 1 km: same anchor scores full points, d = r passes with 0 points', () => {
    const near = person({ radiusKm: 1 })
    expect(matchScore(near, near).parts[1]!.points).toBe(25)
    const edge = person({ radiusKm: 1, anchorLat: ANGGREK.lat + 1 / KM_PER_DEG })
    expect(anchorDistanceKm(near, edge)).toBeCloseTo(1, 2)
    const far = person({ radiusKm: 1, anchorLat: ANGGREK.lat + 1.2 / KM_PER_DEG })
    expect(hardFilter(near, far)).toBe('JARAK')
  })
  it('the smaller radius decides', () => {
    const a = person({ radiusKm: 15 })
    const b = person({ radiusKm: 2, anchorLat: ANGGREK.lat + 3 / KM_PER_DEG })
    expect(hardFilter(a, b)).toBe('JARAK')
  })
})

describe('lifestyle', () => {
  it('every cell of every field: equal 1, adjacent 0.5, opposite 0, BEBAS 0.75', () => {
    for (const key of LIFESTYLE_KEYS) {
      const vals = LIFESTYLE_VALUES[key] as readonly string[]
      const levels = vals.filter((v) => v !== 'BEBAS')
      for (const x of vals) {
        for (const y of vals) {
          const expected = x === 'BEBAS' || y === 'BEBAS' ? 0.75 : { 0: 1, 1: 0.5, 2: 0 }[Math.abs(levels.indexOf(x) - levels.indexOf(y)) as 0 | 1 | 2]
          expect(lifestyleFieldScore(key as LifestyleKey, x as never, y as never), `${key} ${x}/${y}`).toBe(expected)
        }
      }
    }
  })
  it('both all-BEBAS gives 11.25 of 15, flagged as approximate (F2)', () => {
    const r = matchScore(person(), person())
    const life = r.parts.find((p) => p.key === 'lifestyle')!
    expect(life.points).toBeLessThan(15)
    expect(life.points).toBe(11)
    expect(life.reason).toBe('Gaya hidup belum banyak diisi.')
    expect(r.approximate).toBe(true)
  })
  it('a smoker and "tidak mau perokok" are refused, both ways', () => {
    expect(hardFilter(person({ smoking: 'MEROKOK' }), person({ smoking: 'TIDAK_MAU_PEROKOK' }))).toBe('MEROKOK')
    expect(hardFilter(person({ smoking: 'TIDAK_MAU_PEROKOK' }), person({ smoking: 'MEROKOK' }))).toBe('MEROKOK')
    expect(hardFilter(person({ smoking: 'MEROKOK' }), person({ smoking: 'TIDAK_MEROKOK_TOLERAN' }))).toBeNull()
  })
})

describe('gender and room', () => {
  it('different gender is refused first', () => {
    expect(hardFilter(person(), person({ gender: 'PEREMPUAN' }))).toBe('GENDER')
  })
  it('room part: roomShare and kos type, CAMPUR matches anything', () => {
    const room = (a: Partial<MatchInput>, b: Partial<MatchInput>) => matchScore(person(a), person(b)).parts[5]!.points
    expect(room({}, {})).toBe(5)
    expect(room({ kosType: 'PUTRA' }, { kosType: 'CAMPUR' })).toBe(5)
    expect(room({ roomShare: 3 }, {})).toBeLessThan(5)
    expect(room({ kosType: 'PUTRA' }, { kosType: 'PUTRI' })).toBeGreaterThanOrEqual(2)
    expect(room({ roomShare: 3, kosType: 'PUTRA' }, { kosType: 'PUTRI' })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

const arbBudget = fc.tuple(fc.integer({ min: 5, max: 30 }), fc.integer({ min: 0, max: 20 })).map(([lo, span]) => ({ budgetMin: lo * 100_000, budgetMax: (lo + span) * 100_000 }))
const arbDay = fc.integer({ min: 0, max: 200 }).map((n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10))
const arbInput: fc.Arbitrary<MatchInput> = fc
  .record({
    budget: arbBudget,
    dLat: fc.double({ min: -0.05, max: 0.05, noNaN: true }),
    dLng: fc.double({ min: -0.05, max: 0.05, noNaN: true }),
    radiusKm: fc.integer({ min: 1, max: 15 }),
    moveInDate: arbDay,
    durationMonths: fc.integer({ min: 1, max: 12 }),
    kosType: fc.constantFrom('CAMPUR', 'PUTRA', 'PUTRI') as fc.Arbitrary<MatchInput['kosType']>,
    roomShare: fc.constantFrom(2, 3),
    gender: fc.constantFrom('LAKI_LAKI', 'PEREMPUAN') as fc.Arbitrary<MatchInput['gender']>,
    sleep: fc.constantFrom(...LIFESTYLE_VALUES.sleep),
    tidiness: fc.constantFrom(...LIFESTYLE_VALUES.tidiness),
    smoking: fc.constantFrom(...LIFESTYLE_VALUES.smoking),
    guests: fc.constantFrom(...LIFESTYLE_VALUES.guests),
    noise: fc.constantFrom(...LIFESTYLE_VALUES.noise),
    social: fc.constantFrom(...LIFESTYLE_VALUES.social),
    study: fc.constantFrom(...LIFESTYLE_VALUES.study),
    ac: fc.constantFrom(...LIFESTYLE_VALUES.ac),
    expenses: fc.constantFrom(...LIFESTYLE_VALUES.expenses),
  })
  .map(({ budget, dLat, dLng, ...rest }) => ({ ...rest, ...budget, anchorLat: ANGGREK.lat + dLat, anchorLng: ANGGREK.lng + dLng }))

describe('matchScore properties', () => {
  it('is symmetric, an integer in 0..100, and the parts sum to the score', () => {
    fc.assert(
      fc.property(arbInput, arbInput, (a, b) => {
        const ab = matchScore(a, b)
        expect(matchScore(b, a)).toEqual(ab)
        expect(Number.isInteger(ab.score)).toBe(true)
        expect(ab.score).toBeGreaterThanOrEqual(0)
        expect(ab.score).toBeLessThanOrEqual(100)
        expect(ab.parts.reduce((s, p) => s + p.points, 0)).toBe(ab.score)
        for (const p of ab.parts) {
          expect(p.points).toBeGreaterThanOrEqual(0)
          expect(p.points).toBeLessThanOrEqual(p.max)
        }
      }),
      { numRuns: 400 },
    )
  })
  it('hardFilter is symmetric, and a refused pair still gets a bounded score', () => {
    fc.assert(
      fc.property(arbInput, arbInput, (a, b) => {
        const reason = hardFilter(a, b)
        expect(hardFilter(b, a)).toBe(reason)
        if (reason !== null) {
          const { score } = matchScore(a, b)
          expect(score).toBeGreaterThanOrEqual(0)
          expect(score).toBeLessThanOrEqual(100)
        }
      }),
      { numRuns: 400 },
    )
  })
  it('a profile matched with itself gets full marks on budget, location, move-in and duration', () => {
    fc.assert(
      fc.property(arbInput, (a) => {
        const r = matchScore(a, a)
        expect(r.parts.slice(0, 4).map((p) => p.points)).toEqual([30, 25, 15, 10])
      }),
    )
  })
  it('widening a range that already contains the other never raises the budget part', () => {
    // Widening only inside the overlap can raise the Jaccard (A 0-10 vs B 5-20, widen B to 2-20), so the property is stated for the cases where overlap stays put.
    fc.assert(
      fc.property(arbBudget, arbBudget, fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 }), (a, b, left, right) => {
        // B inside A: any widening of A keeps the overlap at |B| and grows the union.
        const inner = { budgetMin: Math.max(a.budgetMin, Math.min(a.budgetMax, b.budgetMin)), budgetMax: Math.min(a.budgetMax, Math.max(a.budgetMin, b.budgetMax)) }
        const wide = { budgetMin: a.budgetMin - left * 100_000, budgetMax: a.budgetMax + right * 100_000 }
        expect(budgetFraction(wide, inner)).toBeLessThanOrEqual(budgetFraction(a, inner) + 1e-12)
      }),
      { numRuns: 400 },
    )
  })
})

describe('matchBand', () => {
  it('cuts at 75 and 50', () => {
    expect([100, 75, 74, 50, 49, 0].map(matchBand)).toEqual(['COCOK_BANGET', 'COCOK_BANGET', 'CUKUP_COCOK', 'CUKUP_COCOK', 'MUNGKIN_COCOK', 'MUNGKIN_COCOK'])
  })
})

describe('ageBand', () => {
  const now = new Date('2026-11-21T00:00:00Z')
  it('buckets by calendar-year difference and never returns the exact age', () => {
    expect(ageBand(2010, now)).toBe('<18')
    expect(ageBand(2008, now)).toBe('18-20')
    expect(ageBand(2006, now)).toBe('18-20')
    expect(ageBand(2005, now)).toBe('21-23')
    expect(ageBand(2003, now)).toBe('21-23')
    expect(ageBand(2002, now)).toBe('24-26')
    expect(ageBand(2000, now)).toBe('24-26')
    expect(ageBand(1999, now)).toBe('27+')
  })
})

describe('containsContactInfo', () => {
  it.each([
    '0812 3456 7890',
    '08123456789',
    'hubungi +62 812-3456-7890 ya',
    'wa 0812-3456-789',
    '0812.3456.7890',
    '628123456789',
    'kirim ke budi@mail.com',
    'cek https://instagram.com/budi',
    'www.contoh.id',
    'chat wa.me/62812345678',
    'ig saya @budi_kos',
    'telegram t.me/budi',
  ])('flags %s', (t) => expect(containsContactInfo(t)).toBe(true))

  it.each([
    'Halo, saya mahasiswa semester 3, suka tenang.',
    'Budget Rp 1.500.000 - 2.000.000 per bulan',
    'Budget 1500000 - 2000000',
    'Pindah 1 Februari 2026, 6 bulan',
    'Kamar 3x4 lantai 2, 08:00 bangun',
    '2026-11-21',
    'Ketemu jam 19.30 di kampus',
    'Ada 2 orang, kos Rp 1,5 jt',
    '',
  ])('allows %s', (t) => expect(containsContactInfo(t)).toBe(false))
})
