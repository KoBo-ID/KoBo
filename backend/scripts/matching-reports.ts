// Operator tool: review user reports from roommate matching.
//
//   npm run matching:reports -w backend -- list                      (OPEN reports, oldest first)
//   npm run matching:reports -w backend -- show <id>                 (details, last messages, profile gender/age)
//   npm run matching:reports -w backend -- action <id> "catatan"     (deactivate the profile, close every OPEN report against it)
//   npm run matching:reports -w backend -- dismiss <id> ["catatan"]  (close it; below 3 reports the profile is un-hidden, not reactivated)
//
// On a PROFIL_PALSU / "Gender tidak sesuai" report, compare the KTM photo with the declared gender (students:review).
// Reviewer name: REVIEWER env, else the OS user name.
import '../src/env.ts'
import os from 'node:os'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { actionReport, dismissReport, listOpenReports, ReportReviewError, showReport } from '../src/matching/safety.ts'

const [cmd, id, note] = process.argv.slice(2)
const reviewer = process.env.REVIEWER || os.userInfo().username
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (cmd === 'list') {
    const rows = await listOpenReports(prisma)
    console.table(rows.map((r) => ({ id: r.id, since: r.createdAt.toISOString().slice(0, 16), reason: r.reason, reporter: r.reporter, reported: r.reported, openAgainst: r.openAgainstReported, counts: r.countsForHide })))
  } else if (cmd === 'show' && id) {
    console.dir(await showReport(prisma, id), { depth: 6 })
  } else if (cmd === 'action' && id && note) {
    console.log(`Actioned ${id}: closed ${(await actionReport(prisma, id, { reviewer, note })).closed} report(s), profile deactivated`)
  } else if (cmd === 'dismiss' && id) {
    const r = await dismissReport(prisma, id, { reviewer, note })
    console.log(`Dismissed ${id}${r.cleared ? ' (profile un-hidden, still inactive until the user turns it on)' : ''}`)
  } else {
    console.error('Usage: list | show <id> | action <id> "note" | dismiss <id> ["note"]')
    process.exitCode = 2
  }
} catch (e) {
  if (e instanceof ReportReviewError) {
    console.error(e.message)
    process.exitCode = 1
  } else throw e
} finally {
  await prisma.$disconnect()
}
