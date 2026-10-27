import { TRPCError } from '@trpc/server'
import { haversineMeters } from '@kobo/shared/domain'
import { isPhoneLike, isUrlLike, placeCategory } from '@kobo/shared/places'
import { ownerPlaceAddInput, ownerPlaceKosInput, ownerPlaceRefInput } from '@kobo/shared/schemas'
import { attachPlaces, loadNearby } from '../placeCatalog.ts'
import { DAY, limiter } from '../rateLimit.ts'
import { ownerProcedure, router } from './trpc.ts'

/** Owner-added places may sit this far from the kos at most; farther is not "nearby". */
const OWNER_PLACE_MAX_METERS = 3000
export const MAX_OWNER_PLACES = 30
export const REFRESH_PER_DAY = 5

export interface OwnerPlaceRow {
  id: string
  name: string
  category: string
  categoryLabel: string
  distanceM: number | null
  /** catalogue = OSM-derived row, owner = added by this owner. */
  origin: 'catalogue' | 'owner'
  hidden: boolean
  /** Only for origin = owner. */
  status: string | null
  sourceLabel: string
}

const NO_CONTACT = 'Nama atau catatan tidak boleh memuat nomor telepon atau tautan.'

export const ownerPlacesRouter = router({
  /** Everything the owner can act on: the shown snapshot, hidden places and their own pending/rejected additions. */
  list: ownerProcedure.input(ownerPlaceKosInput).query(async ({ ctx, input }): Promise<OwnerPlaceRow[]> => {
    const [snap, owned] = await Promise.all([
      ctx.prisma.kosPlace.findMany({ where: { kosId: input.kosId }, orderBy: [{ category: 'asc' }, { rank: 'asc' }] }),
      ctx.prisma.ownerPlace.findMany({ where: { kosId: input.kosId }, orderBy: { createdAt: 'desc' } }),
    ])
    const catalog = await ctx.prisma.placeCatalog.findMany({ where: { id: { in: snap.map((s) => s.placeId) } }, select: { id: true, name: true } })
    const campuses = await ctx.prisma.campus.findMany({ where: { id: { in: snap.map((s) => s.placeId) } }, select: { id: true, name: true } })
    const names = new Map<string, string>([...catalog.map((c) => [c.id, c.name] as const), ...campuses.map((c) => [c.id, c.name] as const), ...owned.map((o) => [o.id, o.name] as const)])
    const label = (c: string) => placeCategory(c)?.label ?? c
    const rows: OwnerPlaceRow[] = snap
      .filter((s) => names.has(s.placeId))
      .map((s) => ({
        id: s.placeId, name: names.get(s.placeId)!, category: s.category, categoryLabel: label(s.category), distanceM: s.distanceM,
        origin: s.addedByOwner ? 'owner' : 'catalogue', hidden: s.hiddenByOwner, status: s.addedByOwner ? 'approved' : null, sourceLabel: s.sourceLabel,
      }))
    const shown = new Set(rows.map((r) => r.id))
    for (const o of owned.filter((x) => !shown.has(x.id))) {
      rows.push({ id: o.id, name: o.name, category: o.category, categoryLabel: label(o.category), distanceM: null, origin: 'owner', hidden: false, status: o.status, sourceLabel: 'Pemilik kos' })
    }
    return rows
  }),

  hide: ownerProcedure.input(ownerPlaceRefInput).mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
    await ctx.prisma.$transaction([
      ctx.prisma.placeOverlay.upsert({ where: { kosId_placeId_override: { kosId: input.kosId, placeId: input.placeId, override: 'hide' } }, create: { kosId: input.kosId, placeId: input.placeId, override: 'hide' }, update: {} }),
      ctx.prisma.kosPlace.updateMany({ where: { kosId: input.kosId, placeId: input.placeId }, data: { hiddenByOwner: true } }),
    ])
    return { ok: true }
  }),

  unhide: ownerProcedure.input(ownerPlaceRefInput).mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
    await ctx.prisma.$transaction([
      ctx.prisma.placeOverlay.deleteMany({ where: { kosId: input.kosId, placeId: input.placeId, override: 'hide' } }),
      ctx.prisma.kosPlace.updateMany({ where: { kosId: input.kosId, placeId: input.placeId }, data: { hiddenByOwner: false } }),
    ])
    return { ok: true }
  }),

  /** Lands as `pending`: invisible to the public until an operator approves it (scripts/approve-places.ts). */
  add: ownerProcedure.input(ownerPlaceAddInput).mutation(async ({ ctx, input }): Promise<{ id: string; status: 'pending' }> => {
    if (isPhoneLike(input.name) || isUrlLike(input.name) || (input.note && (isPhoneLike(input.note) || isUrlLike(input.note)))) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: NO_CONTACT })
    }
    const kos = await ctx.prisma.kos.findUniqueOrThrow({ where: { id: input.kosId }, select: { lat: true, lng: true } })
    if (haversineMeters(kos, { lat: input.lat, lng: input.lng }) > OWNER_PLACE_MAX_METERS) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Tempat harus berada maksimal ${OWNER_PLACE_MAX_METERS / 1000} km dari kos.` })
    }
    if ((await ctx.prisma.ownerPlace.count({ where: { kosId: input.kosId } })) >= MAX_OWNER_PLACES) {
      throw new TRPCError({ code: 'CONFLICT', message: `Maksimal ${MAX_OWNER_PLACES} tempat tambahan per kos.` })
    }
    limiter.check(`owner-place:${ctx.user.id}`, 30, DAY, 'Terlalu banyak tempat ditambahkan hari ini. Coba lagi besok.')
    const row = await ctx.prisma.ownerPlace.create({ data: { kosId: input.kosId, name: input.name, category: input.category, lat: input.lat, lng: input.lng, note: input.note ?? null }, select: { id: true } })
    return { id: row.id, status: 'pending' }
  }),

  /** Removes an owner-added place (any status). Catalogue places are hidden, never deleted. */
  remove: ownerProcedure.input(ownerPlaceRefInput).mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
    const res = await ctx.prisma.$transaction(async (tx) => {
      const gone = await tx.ownerPlace.deleteMany({ where: { id: input.placeId, kosId: input.kosId } })
      if (gone.count > 0) await tx.kosPlace.deleteMany({ where: { kosId: input.kosId, placeId: input.placeId } })
      return gone.count
    })
    if (res === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tempat tidak ditemukan di kos ini.' })
    return { ok: true }
  }),

  /** Rebuilds the snapshot from the current catalogue; owner hides and approved additions are kept. */
  refresh: ownerProcedure.input(ownerPlaceKosInput).mutation(async ({ ctx, input }): Promise<{ catalogVersion: string; rows: number }> => {
    limiter.check(`owner-place-refresh:${input.kosId}`, REFRESH_PER_DAY, DAY, `Pembaruan sekitar kos dibatasi ${REFRESH_PER_DAY} kali per hari.`)
    return ctx.prisma.$transaction((tx) => attachPlaces(tx, input.kosId))
  }),

  /** The public view the owner sees as a preview. */
  preview: ownerProcedure.input(ownerPlaceKosInput).query(({ ctx, input }) => loadNearby(ctx.prisma, input.kosId)),
})
