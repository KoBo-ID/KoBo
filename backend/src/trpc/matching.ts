// Roommate matching router (T1, ADR 0022). One file per area so workers own them separately.
import { router } from './trpc.ts'
import { profileProcedures } from './matching/profile.ts'
import { requestProcedures } from './matching/requests.ts'
import { messageProcedures } from './matching/messages.ts'
import { shortlistProcedures } from './matching/shortlist.ts'
import { safetyProcedures } from './matching/safety.ts'

export const matchingRouter = router({
  ...profileProcedures,
  ...requestProcedures,
  ...messageProcedures,
  ...shortlistProcedures,
  ...safetyProcedures,
})
