import { randomUUID } from 'node:crypto'
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_PER_KOS, imageConfirmInput, imageDeleteInput, imagePresignInput, imageReorderInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { Prisma } from '../generated/prisma/client.ts'
import { HOUR, limiterFor } from '../rateLimit.ts'
import { lockKos } from '../waitlist.ts'
import { hasImageSignature, PRESIGN_EXPIRES_SECONDS } from '../storage.ts'
import { ownerProcedure, router } from './trpc.ts'

export interface ImagePresign {
  key: string
  url: string
  /** Headers the browser must send with the PUT. */
  headers: Record<string, string>
  expiresInSeconds: number
}

export interface OwnerImage {
  id: string
  url: string
  order: number
  width: number | null
  height: number | null
}

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })

export const ownerImageRouter = router({
  /** A short-lived presigned PUT. Type and length are signed, so R2 refuses anything else. */
  presign: ownerProcedure.input(imagePresignInput).mutation(async ({ ctx, input }): Promise<ImagePresign> => {
    limiterFor(ctx).check(`presign:${ctx.user.id}`, 60, HOUR, 'Terlalu banyak unggahan foto. Coba lagi dalam satu jam.')
    const key = `kos/${input.kosId}/${input.baseId ?? randomUUID()}-${input.width}.webp`
    const signed = await ctx.storage.presignPut(key, input.contentType, input.contentLength)
    return { key, url: signed.url, headers: signed.headers, expiresInSeconds: PRESIGN_EXPIRES_SECONDS }
  }),

  /** Trust nothing from the browser: HEAD the object, check type and size, then record it. Idempotent per key. */
  confirm: ownerProcedure.input(imageConfirmInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    if (!/^kos\/[^/]+\/[0-9a-f-]{36}-\d{3,4}\.webp$/.test(input.key) || !input.key.startsWith(`kos/${input.kosId}/`)) throw bad('Kunci foto tidak valid.')
    const existing = await ctx.prisma.kosImage.findFirst({ where: { key: input.key }, select: { id: true } })
    if (existing) return existing
    const head = await ctx.storage.head(input.key)
    if (!head) throw bad('Foto belum terunggah. Silakan coba unggah ulang.')
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(head.contentType)) {
      await ctx.storage.delete(input.key)
      throw bad('Jenis file foto tidak didukung. Gunakan WebP atau JPEG.')
    }
    if (head.contentLength <= 0 || head.contentLength > IMAGE_MAX_BYTES) {
      await ctx.storage.delete(input.key)
      throw bad('Ukuran foto melebihi batas 2 MB.')
    }
    // The declared type is only a label: check the file's own signature so HTML, SVG or scripts cannot be filed as photos.
    const first = await ctx.storage.peek(input.key, 16)
    if (!first || !hasImageSignature(head.contentType, first)) {
      await ctx.storage.delete(input.key)
      throw bad('Isi file bukan foto yang valid. Gunakan WebP atau JPEG.')
    }
    // Count and insert under the kos row lock, so parallel confirms cannot all pass the check (B-13).
    const created = await ctx.prisma.$transaction(async (tx) => {
      await lockKos(tx, input.kosId)
      const dup = await tx.kosImage.findFirst({ where: { key: input.key }, select: { id: true } })
      if (dup) return { id: dup.id, full: false }
      if ((await tx.kosImage.count({ where: { kosId: input.kosId } })) >= IMAGE_MAX_PER_KOS) return { id: null, full: true }
      const row = await tx.kosImage.create({
        data: { kosId: input.kosId, key: input.key, order: input.order, width: input.width, height: input.height },
        select: { id: true },
      })
      return { id: row.id, full: false }
    })
    if (created.full || !created.id) {
      await ctx.storage.delete(input.key)
      throw bad(`Satu kos maksimal ${IMAGE_MAX_PER_KOS} foto.`)
    }
    return { id: created.id }
  }),

  /** Removes the row and, for uploaded photos, the stored object. Seeded external-URL photos only lose the row. */
  delete: ownerProcedure.input(imageDeleteInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const img = await ctx.prisma.kosImage.findFirst({ where: { id: input.imageId, kosId: input.kosId }, select: { id: true, key: true } })
    if (!img) throw new TRPCError({ code: 'NOT_FOUND', message: 'Foto tidak ditemukan.' })
    await ctx.prisma.kosImage.delete({ where: { id: img.id } })
    if (img.key) {
      // The photo's sibling variants share its uuid (the browser uploads a 800 px and a 1600 px copy).
      const stem = img.key.replace(/-\d+\.webp$/, '')
      await Promise.all([img.key, `${stem}-800.webp`, `${stem}-1600.webp`].map((k) => ctx.storage.delete(k).catch(() => undefined)))
    }
    return { id: img.id }
  }),

  /** `imageIds` is the complete new order of the kos's photos. */
  reorder: ownerProcedure.input(imageReorderInput).mutation(async ({ ctx, input }): Promise<{ count: number }> => {
    const rows = await ctx.prisma.kosImage.findMany({ where: { kosId: input.kosId }, select: { id: true }, take: 200 })
    const known = new Set(rows.map((r) => r.id))
    if (new Set(input.imageIds).size !== input.imageIds.length || input.imageIds.some((id) => !known.has(id))) throw bad('Daftar foto tidak valid.')
    // One statement for the whole order (H-002), scoped to this kos.
    if (input.imageIds.length > 0) {
      const values = Prisma.join(input.imageIds.map((id, order) => Prisma.sql`(${id}, ${order}::int)`))
      await ctx.prisma.$executeRaw`UPDATE "KosImage" AS k SET "order" = v.ord FROM (VALUES ${values}) AS v(id, ord) WHERE k.id = v.id AND k."kosId" = ${input.kosId}`
    }
    return { count: input.imageIds.length }
  }),
})
