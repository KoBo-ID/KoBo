// Operator tool: review KTM photos uploaded by students who cannot use a campus email or account.
//
//   npm run students:review -w backend -- list                          (pending, oldest first)
//   npm run students:review -w backend -- show <id>                     (details + a 120 s link to the photo)
//   npm run students:review -w backend -- approve <id> <YYYY-MM-DD>     (verify until that date, at most 365 days ahead)
//   npm run students:review -w backend -- reject <id> "<reason>"        (the student sees the reason)
//
// Compare the name and NIM on the photo with what the student typed, and check the card is valid for the semester.
// Reviewer name: REVIEWER env, else the OS user name. The photo is deleted 30 days after the decision.
import '../src/env.ts'
import os from 'node:os'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { storageFromEnv } from '../src/storage.ts'
import { approveDocument, listPending, rejectDocument, ReviewError, showDocument } from '../src/studentVerification/review.ts'

const [cmd, id, third] = process.argv.slice(2)
const reviewer = process.env.REVIEWER || os.userInfo().username
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (cmd === 'list') {
    const rows = await listPending(prisma)
    console.table(rows.map((r) => ({ id: r.id, since: r.createdAt.toISOString().slice(0, 16), email: r.email, name: r.name, campus: r.campus, nim: r.nim })))
  } else if (cmd === 'show' && id) {
    const d = await showDocument(prisma, storageFromEnv(), id)
    console.log({ ...d, createdAt: d.createdAt.toISOString() })
    console.log('The link expires in 120 seconds.')
  } else if (cmd === 'approve' && id && third) {
    const r = await approveDocument(prisma, id, { reviewer, validUntil: third })
    console.log(`Approved ${id}: verified until ${r.until.toISOString()}`)
  } else if (cmd === 'reject' && id && third) {
    await rejectDocument(prisma, id, { reviewer, reason: third })
    console.log(`Rejected ${id}`)
  } else {
    console.error('Usage: list | show <id> | approve <id> <YYYY-MM-DD> | reject <id> "<reason>"')
    process.exitCode = 2
  }
} catch (e) {
  if (e instanceof ReviewError) {
    console.error(e.message)
    process.exitCode = 1
  } else throw e
} finally {
  await prisma.$disconnect()
}
