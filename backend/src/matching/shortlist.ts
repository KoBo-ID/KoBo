// Shared kos shortlist of a connection, and "Cari kos bersama" candidates near the midpoint of the two anchors.
import { haversineMeters } from '@kobo/shared/domain'
import type { KosCandidate, SharedShortlistEntry } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { Kos, PartnerConnection, Prisma, Room } from '../generated/prisma/client.ts'
import { isBlockedEither } from './eligibility.ts'
import { partnerName, partnerUserId, requireMyConnection } from './messages.ts'
import type { Db } from './profiles.ts'

export const MAX_SHORTLIST = 30
export const MAX_KOS_CANDIDATES = 30
/** Copy the frontend shows next to a candidate's status. */
export const KOS_STATUS_LABEL = { SHAREABLE: 'Bisa berdua', ASK_OWNER: 'Kapasitas belum diketahui · Tanyakan pemilik' } as const

export type ShortlistEntry = SharedShortlistEntry & { /** "Kamu" or the partner's display name. */ addedBy: string }

/** A kos anyone may see: its owner is approved (DISETUJUI) and it is not archived. */
export const publicKosWhere: Prisma.KosWhereInput = { archivedAt: null, owner: { verificationStatus: 'DISETUJUI' } }

async function requireLive(db: Db, me: string, connectionId: string): Promise<PartnerConnection> {
  const c = await requireMyConnection(db, me, connectionId)
  if (c.endedAt !== null) throw new TRPCError({ code: 'FORBIDDEN', message: 'Koneksi ini sudah berakhir, daftar kos tidak bisa diubah lagi.' })
  if (await isBlockedEither(db, c.userAId, c.userBId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Daftar kos tidak bisa diubah.' })
  return c
}

const lowest = (rooms: Pick<Room, 'priceMonthly'>[]): number => (rooms.length ? Math.min(...rooms.map((r) => r.priceMonthly)) : 0)

export async function listShortlist(db: Db, me: string, connectionId: string): Promise<ShortlistEntry[]> {
  const conn = await requireMyConnection(db, me, connectionId)
  const items = await db.sharedShortlistItem.findMany({
    where: { connectionId: conn.id, kos: publicKosWhere },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { kos: { include: { rooms: { where: { archivedAt: null }, select: { priceMonthly: true } } } } },
  })
  const name = await partnerName(db, partnerUserId(conn, me))
  return items.map((i) => ({
    kosId: i.kosId,
    slug: i.kos.slug,
    name: i.kos.name,
    city: i.kos.city,
    district: i.kos.district,
    priceFrom: lowest(i.kos.rooms),
    addedByMe: i.addedById === me,
    addedBy: i.addedById === me ? 'Kamu' : name,
    createdAt: i.createdAt.toISOString(),
  }))
}

export async function addToShortlist(db: Db, me: string, input: { connectionId: string; kosId: string }): Promise<{ ok: true }> {
  const conn = await requireLive(db, me, input.connectionId)
  const kos = await db.kos.findFirst({ where: { id: input.kosId, ...publicKosWhere }, select: { id: true } })
  if (!kos) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos tidak ditemukan.' })
  if ((await db.sharedShortlistItem.count({ where: { connectionId: conn.id } })) >= MAX_SHORTLIST) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Daftar kos bersama maksimal ${MAX_SHORTLIST}. Hapus satu dulu.` })
  }
  try {
    await db.sharedShortlistItem.create({ data: { connectionId: conn.id, kosId: kos.id, addedById: me } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new TRPCError({ code: 'CONFLICT', message: 'Kos ini sudah ada di daftar bersama.' })
    throw e
  }
  return { ok: true }
}

export async function removeFromShortlist(db: Db, me: string, input: { connectionId: string; kosId: string }): Promise<{ ok: true }> {
  const conn = await requireLive(db, me, input.connectionId)
  const r = await db.sharedShortlistItem.deleteMany({ where: { connectionId: conn.id, kosId: input.kosId } })
  if (r.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos ini tidak ada di daftar bersama.' })
  return { ok: true }
}

/** K1: the text to prefill RentalApplication.note once the user consents. */
export async function applicationNoteFor(db: Db, me: string, connectionId: string): Promise<{ note: string }> {
  const conn = await requireMyConnection(db, me, connectionId)
  return { note: `Calon teman sekamar: ${await partnerName(db, partnerUserId(conn, me))}` }
}

type FitRoom = Pick<Room, 'priceMonthly' | 'pricePerPersonMonthly' | 'maxOccupants'>
interface Fit {
  total: number
  price: number
  unit: KosCandidate['priceUnit']
}

/** What a room costs the pair, or null when it does not fit. Shared rooms use the per-person price (x2) when the owner set one. */
function shareableFit(r: FitRoom, combined: number): Fit | null {
  if (r.maxOccupants < 2) return null
  const perPerson = r.pricePerPersonMonthly
  const f: Fit = perPerson ? { total: perPerson * 2, price: perPerson, unit: 'PER_ORANG' } : { total: r.priceMonthly, price: r.priceMonthly, unit: 'PER_KAMAR' }
  return f.total <= combined ? f : null
}
const unknownFit = (r: FitRoom, combined: number): Fit | null =>
  r.maxOccupants < 2 && r.priceMonthly <= combined ? { total: r.priceMonthly, price: r.priceMonthly, unit: 'PER_KAMAR' } : null

const cheapest = (fits: Fit[]): Fit => fits.reduce((a, b) => (b.total < a.total ? b : a))

export async function kosCandidates(db: Db, me: string, connectionId: string): Promise<KosCandidate[]> {
  const conn = await requireMyConnection(db, me, connectionId)
  const [a, b] = await Promise.all([
    db.matchingProfile.findUnique({ where: { userId: conn.userAId } }),
    db.matchingProfile.findUnique({ where: { userId: conn.userBId } }),
  ])
  if (!a || !b) return []

  const mid = { lat: (a.anchorLat + b.anchorLat) / 2, lng: (a.anchorLng + b.anchorLng) / 2 }
  const radiusM = Math.max(1, Math.min(a.radiusKm, b.radiusKm)) * 1000
  const combined = a.budgetMax + b.budgetMax
  const kosGenders: Kos['gender'][] = a.gender === 'LAKI_LAKI' ? ['PUTRA', 'CAMPUR'] : ['PUTRI', 'CAMPUR']
  // Bounding box first (1 degree of latitude is about 111 km), exact distance after.
  const dLat = radiusM / 111_000
  const dLng = radiusM / (111_000 * Math.max(0.1, Math.cos((mid.lat * Math.PI) / 180)))

  const [kosList, saved] = await Promise.all([
    db.kos.findMany({
      where: {
        ...publicKosWhere,
        gender: { in: kosGenders },
        lat: { gte: mid.lat - dLat, lte: mid.lat + dLat },
        lng: { gte: mid.lng - dLng, lte: mid.lng + dLng },
        rooms: { some: { archivedAt: null, occupancy: 'VACANT', OR: [{ priceMonthly: { lte: combined } }, { pricePerPersonMonthly: { lte: Math.floor(combined / 2) } }] } },
      },
      include: { rooms: { where: { archivedAt: null, occupancy: 'VACANT' } } },
    }),
    db.sharedShortlistItem.findMany({ where: { connectionId: conn.id }, select: { kosId: true } }),
  ])
  const savedIds = new Set(saved.map((s) => s.kosId))

  const out: (KosCandidate & { distance: number })[] = []
  for (const k of kosList) {
    const distance = haversineMeters(mid, { lat: k.lat, lng: k.lng })
    if (distance > radiusM) continue
    const shareable = k.rooms.map((r) => shareableFit(r, combined)).filter((f): f is Fit => f !== null)
    const unknown = k.rooms.map((r) => unknownFit(r, combined)).filter((f): f is Fit => f !== null)
    const status: KosCandidate['status'] | null = shareable.length ? 'SHAREABLE' : unknown.length ? 'ASK_OWNER' : null
    if (!status) continue
    const fits = status === 'SHAREABLE' ? shareable : unknown
    const best = cheapest(fits)
    out.push({
      kosId: k.id,
      slug: k.slug,
      name: k.name,
      city: k.city,
      district: k.district,
      status,
      price: best.price,
      priceUnit: best.unit,
      roomsFitting: fits.length,
      inShortlist: savedIds.has(k.id),
      distance,
    })
  }
  out.sort((x, y) => (x.status === y.status ? x.distance - y.distance : x.status === 'SHAREABLE' ? -1 : 1))
  return out.slice(0, MAX_KOS_CANDIDATES).map(({ distance: _d, ...rest }) => rest)
}
