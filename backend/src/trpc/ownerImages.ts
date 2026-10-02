import { randomUUID } from 'node:crypto'
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_PER_KOS, imageConfirmInput, imageDeleteInput, imagePresignInput, imageReorderInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { PRESIGN_EXPIRES_SECONDS } from '../storage.ts'
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
    if ((await ctx.prisma.kosImage.count({ where: { kosId: input.kosId } })) >= IMAGE_MAX_PER_KOS) {
      await ctx.storage.delete(input.key)
      throw bad(`Satu kos maksimal ${IMAGE_MAX_PER_KOS} foto.`)
    }
    return ctx.prisma.kosImage.create({
      data: { kosId: input.kosId, key: input.key, order: input.order, width: input.width, height: input.height },
      select: { id: true },
    })
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
    const rows = await ctx.prisma.kosImage.findMany({ where: { kosId: input.kosId }, select: { id: true } })
    const known = new Set(rows.map((r) => r.id))
    if (new Set(input.imageIds).size !== input.imageIds.length || input.imageIds.some((id) => !known.has(id))) throw bad('Daftar foto tidak valid.')
    await ctx.prisma.$transaction(input.imageIds.map((id, order) => ctx.prisma.kosImage.update({ where: { id }, data: { order } })))
    return { count: input.imageIds.length }
  }),
})
