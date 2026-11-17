import { TRPCError } from '@trpc/server'
import { placeReverseInput } from '@kobo/shared/schemas'
import { z } from 'zod'
import type { AddressMatch } from '../geocode.ts'
import { GeocoderUnavailable } from '../geocode.ts'
import { nearestCampuses, placesNear } from '../placeCatalog.ts'
import type { CampusNear, RankedByCategory } from '../placeCatalog.ts'
import { limiterFor } from '../rateLimit.ts'
import { regionLookup, sameRegionName } from '../regionLookup.ts'
import type { RegionHit } from '../regionLookup.ts'
import { authedProcedure, publicProcedure, router } from './trpc.ts'

/** A geocoded address checked against our own Region table: the point decides, a disagreeing district name is flagged. */
export interface ResolvedAddress extends AddressMatch {
  region: RegionHit | null
  /** True when the named kecamatan and the point's kecamatan differ, so the owner must confirm before saving. */
  needsConfirmation: boolean
  /** Indonesian explanation for the owner when needsConfirmation is set. */
  confirmationNote: string | null
}

export interface ReverseResult {
  region: RegionHit | null
  campuses: CampusNear[]
  /** A short preview (up to 2 per category, nearest first): enough for the owner form, not the full list. */
  places: { category: string; items: { id: string; name: string; distanceM: number }[] }[]
}

const previewOf = (ranked: RankedByCategory[]): ReverseResult['places'] =>
  ranked.filter((r) => r.primary.length > 0).map((r) => ({ category: r.category, items: r.primary.slice(0, 2).map((p) => ({ id: p.id, name: p.name, distanceM: p.distanceM })) }))

export const placeRouter = router({
  /**
   * Free text to a map point. Called when the user submits the Search box (never while typing). Returns null when
   * the place is unknown, so the client falls back to a text search on kos addresses.
   */
  search: publicProcedure.input(z.object({ q: z.string().trim().min(2).max(100) })).query(async ({ ctx, input }) => {
    try {
      return await ctx.geocoder.search(input.q)
    } catch (e) {
      if (e instanceof GeocoderUnavailable) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Pencarian lokasi sedang tidak tersedia. Coba lagi sebentar.' })
      throw e
    }
  }),

  /**
   * The owner form's address field: a full address to its point, city and district, so those inputs fill themselves.
   * Called from a button (never while typing, per the Nominatim policy) and limited per user. The point is then checked
   * against Region: when the district the text names is not the district the point lies in, the owner is asked to confirm.
   */
  resolveAddress: authedProcedure.input(z.object({ q: z.string().trim().min(5).max(200) })).mutation(async ({ ctx, input }): Promise<ResolvedAddress | null> => {
    limiterFor(ctx).check(`address:${ctx.user.id}`, 20, 60_000, 'Terlalu banyak pencarian alamat. Tunggu sebentar lalu coba lagi.')
    let match: AddressMatch | null
    try {
      match = await ctx.geocoder.resolveAddress(input.q)
    } catch (e) {
      if (e instanceof GeocoderUnavailable) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Pencarian alamat sedang tidak tersedia. Isi kota dan kecamatan secara manual.' })
      throw e
    }
    if (!match) return null
    const region = await regionLookup(ctx.prisma, { lat: match.lat, lng: match.lng })
    // district is "Kelurahan, Kecamatan" (or just the kecamatan); the last part is the kecamatan the text named.
    const named = match.district.split(',').map((s) => s.trim()).filter(Boolean).at(-1)
    const disagree = !!(region && named && !sameRegionName(named, region.kecamatan.name))
    // Near a boundary or the coast the boundary data has gaps of ~100 m: the answer is the nearest area, so say so.
    const weak = !!region && region.confidence !== 'polygon'
    return {
      ...match,
      region,
      needsConfirmation: disagree || weak,
      confirmationNote: disagree
        ? `Titik peta berada di Kecamatan ${region!.kecamatan.name}, bukan ${named}. Periksa titiknya sebelum menyimpan.`
        : weak
          ? `Titik peta berada di dekat batas wilayah; kecamatan terdekat adalah ${region!.kecamatan.name}. Periksa titiknya sebelum menyimpan.`
          : null,
    }
  }),

  /** Pin to region, nearest campuses and a places preview. For the owner form when the pin is dragged. */
  reverse: authedProcedure.input(placeReverseInput).mutation(async ({ ctx, input }): Promise<ReverseResult> => {
    limiterFor(ctx).check(`reverse:${ctx.user.id}`, 20, 60_000, 'Terlalu banyak pencarian titik. Tunggu sebentar lalu coba lagi.')
    const point = { lat: input.lat, lng: input.lng }
    const [region, campuses, ranked] = await Promise.all([regionLookup(ctx.prisma, point), nearestCampuses(ctx.prisma, point, 3), placesNear(ctx.prisma, point)])
    return { region, campuses, places: previewOf(ranked) }
  }),
})
