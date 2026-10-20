import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { GeocoderUnavailable } from '../geocode.ts'
import { publicProcedure, router } from './trpc.ts'

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
})
