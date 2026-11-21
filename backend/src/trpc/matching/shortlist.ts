// Matching sub-router (T1); composed in ../matching.ts. Logic lives in src/matching/shortlist.ts.
import { connectionIdInput, shortlistAddInput, shortlistRemoveInput } from '@kobo/shared/schemas'
import type { KosCandidate } from '@kobo/shared/types'
import { addToShortlist, applicationNoteFor, kosCandidates, listShortlist, removeFromShortlist, type ShortlistEntry } from '../../matching/shortlist.ts'
import { router } from '../trpc.ts'
import { matchingProcedure } from './guard.ts'

const shortlist = router({
  list: matchingProcedure.input(connectionIdInput).query(({ ctx, input }): Promise<ShortlistEntry[]> => listShortlist(ctx.prisma, ctx.user.id, input.connectionId)),
  add: matchingProcedure.input(shortlistAddInput).mutation(({ ctx, input }): Promise<{ ok: true }> => addToShortlist(ctx.prisma, ctx.user.id, input)),
  remove: matchingProcedure.input(shortlistRemoveInput).mutation(({ ctx, input }): Promise<{ ok: true }> => removeFromShortlist(ctx.prisma, ctx.user.id, input)),
  kosCandidates: matchingProcedure.input(connectionIdInput).query(({ ctx, input }): Promise<KosCandidate[]> => kosCandidates(ctx.prisma, ctx.user.id, input.connectionId)),
  /** K1: prefill for RentalApplication.note, only after the user consents. */
  applicationNoteFor: matchingProcedure.input(connectionIdInput).query(({ ctx, input }): Promise<{ note: string }> => applicationNoteFor(ctx.prisma, ctx.user.id, input.connectionId)),
})

export const shortlistProcedures = { shortlist }
