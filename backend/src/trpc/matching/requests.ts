// Matching sub-router (T1): partner requests and connections. Logic lives in ../../matching/requests.ts.
import { connectionIdInput, requestIdInput, requestListInput, requestSendInput } from '@kobo/shared/schemas'
import type { PartnerConnectionView, PartnerRequestList, PartnerRequestView } from '@kobo/shared/types'
import { acceptRequest, cancelRequest, declineRequest, endConnection, listConnections, listRequests, sendRequest } from '../../matching/requests.ts'
import { router } from '../trpc.ts'
import { matchingProcedure } from './guard.ts'

const request = router({
  send: matchingProcedure.input(requestSendInput).mutation(({ ctx, input }): Promise<PartnerRequestView> => sendRequest(ctx.prisma, ctx.user.id, input, new Date())),
  cancel: matchingProcedure.input(requestIdInput).mutation(({ ctx, input }): Promise<{ ok: true }> => cancelRequest(ctx.prisma, ctx.user.id, input.requestId, new Date())),
  accept: matchingProcedure.input(requestIdInput).mutation(({ ctx, input }): Promise<PartnerConnectionView> => acceptRequest(ctx.prisma, ctx.user.id, input.requestId, new Date())),
  decline: matchingProcedure.input(requestIdInput).mutation(({ ctx, input }): Promise<{ ok: true }> => declineRequest(ctx.prisma, ctx.user.id, input.requestId, new Date())),
  list: matchingProcedure.input(requestListInput).query(({ ctx, input }): Promise<PartnerRequestList> => listRequests(ctx.prisma, ctx.user.id, input, new Date())),
})

const connection = router({
  list: matchingProcedure.query(({ ctx }): Promise<PartnerConnectionView[]> => listConnections(ctx.prisma, ctx.user.id, new Date())),
  end: matchingProcedure.input(connectionIdInput).mutation(({ ctx, input }): Promise<{ ok: true }> => endConnection(ctx.prisma, ctx.user.id, input.connectionId, new Date())),
})

export const requestProcedures = { request, connection }
