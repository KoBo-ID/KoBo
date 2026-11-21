// Matching sub-router (T1); composed in ../matching.ts. Logic lives in src/matching/safety.ts.
import { blockInput, reportInput, unblockInput } from '@kobo/shared/schemas'
import type { MatchBlockView } from '@kobo/shared/types'
import { blockProfile, listBlocks, reportProfile, unblock } from '../../matching/safety.ts'
import { router } from '../trpc.ts'
import { matchingProcedure } from './guard.ts'

const safety = router({
  block: matchingProcedure.input(blockInput).mutation(({ ctx, input }): Promise<{ ok: true }> => blockProfile(ctx.prisma, ctx.user.id, input.profileId)),
  unblock: matchingProcedure.input(unblockInput).mutation(({ ctx, input }): Promise<{ ok: true }> => unblock(ctx.prisma, ctx.user.id, input.blockId)),
  blocks: matchingProcedure.query(({ ctx }): Promise<MatchBlockView[]> => listBlocks(ctx.prisma, ctx.user.id)),
  report: matchingProcedure.input(reportInput).mutation(({ ctx, input }): Promise<{ ok: true }> => reportProfile(ctx.prisma, ctx.user.id, input)),
})

export const safetyProcedures = { safety }
