// Matching sub-router (T1); composed in ../matching.ts. Logic lives in src/matching/messages.ts.
import { connectionIdInput, messageListInput, messageSendInput } from '@kobo/shared/schemas'
import type { MatchingUnread, PartnerMessagePage, PartnerMessageSendResult } from '@kobo/shared/types'
import { listMessages, markRead, sendMessage, unreadCount } from '../../matching/messages.ts'
import { router } from '../trpc.ts'
import { matchingProcedure } from './guard.ts'

const message = router({
  list: matchingProcedure.input(messageListInput).query(({ ctx, input }): Promise<PartnerMessagePage> => listMessages(ctx.prisma, ctx.user.id, input)),
  send: matchingProcedure.input(messageSendInput).mutation(({ ctx, input }): Promise<PartnerMessageSendResult> => sendMessage(ctx.prisma, ctx.user.id, input)),
  markRead: matchingProcedure.input(connectionIdInput).mutation(({ ctx, input }): Promise<{ ok: true }> => markRead(ctx.prisma, ctx.user.id, input.connectionId)),
  /** `messages` and `requests` are the nav badge; `perConnection` maps a live connection id to its unread count. */
  unreadCount: matchingProcedure.query(({ ctx }): Promise<MatchingUnread & { perConnection: Record<string, number> }> => unreadCount(ctx.prisma, ctx.user.id)),
})

export const messageProcedures = { message }
