// Operator tool: review the KTP and land-rights documents of new kos owners.
//
//   npm run owners:review -w backend -- list                                       (waiting owners, oldest first)
//   npm run owners:review -w backend -- show <ownerUserId>                         (details + 120 s links to every document)
//   npm run owners:review -w backend -- approve <ownerUserId>                      (sets DISETUJUI)
//   npm run owners:review -w backend -- reject <ownerUserId> <CODE> ["note"] [--kinds=KTP,SHM]
//   npm run owners:review -w backend -- reset <ownerUserId>                        (attempts back to 0)
//
// CODE: KTP_BURAM | NAMA_TIDAK_SAMA | DOKUMEN_TIDAK_SESUAI | KUASA_TIDAK_ADA. The owner sees the reason text of the code
// plus your note. --kinds marks only those documents REJECTED (the rest are kept as APPROVED); without it the code
// decides (KTP_BURAM: KTP, KUASA_TIDAK_ADA: SURAT_KUASA, others: all documents).
// Reviewer name: REVIEWER env, else the OS user name. Documents are deleted 90 days after the decision.
import '../src/env.ts'
import os from 'node:os'
import { OWNER_DOC_KINDS, type OwnerDocKind } from '@kobo/shared/schemas'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { approveOwner, isRejectCode, listPendingOwners, OWNER_REJECT_REASONS, rejectOwner, resetOwner, ReviewError, showOwner } from '../src/ownerVerification/review.ts'
import { storageFromEnv } from '../src/storage.ts'

const args = process.argv.slice(2)
const kindsFlag = args.find((a) => a.startsWith('--kinds='))
const [cmd, userId, third, fourth] = args.filter((a) => !a.startsWith('--kinds='))
const reviewer = process.env.REVIEWER || os.userInfo().username
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (cmd === 'list') {
    const rows = await listPendingOwners(prisma)
    console.table(rows.map((r) => ({ userId: r.userId, since: r.since.toISOString().slice(0, 16), email: r.email, name: r.name, role: r.ownershipType, attempts: r.attempts, docs: r.kinds.join(',') })))
  } else if (cmd === 'show' && userId) {
    const o = await showOwner(prisma, storageFromEnv(), userId)
    console.log({ ...o, documents: undefined })
    for (const d of o.documents) console.log(`${d.kind} [${d.status}] ${d.createdAt.toISOString()}\n  ${d.url}`)
    console.log('The links expire in 120 seconds.')
  } else if (cmd === 'approve' && userId) {
    await approveOwner(prisma, userId, { reviewer })
    console.log(`Approved ${userId}`)
  } else if (cmd === 'reject' && userId && third) {
    if (!isRejectCode(third)) throw new ReviewError(`Unknown code. Use one of: ${Object.keys(OWNER_REJECT_REASONS).join(', ')}`)
    const kinds = kindsFlag ? kindsFlag.slice('--kinds='.length).split(',').map((k) => k.trim()) : undefined
    const unknown = kinds?.find((k) => !(OWNER_DOC_KINDS as readonly string[]).includes(k))
    if (unknown) throw new ReviewError(`Unknown document kind ${unknown}. Use: ${OWNER_DOC_KINDS.join(', ')}`)
    await rejectOwner(prisma, userId, { reviewer, code: third, note: fourth, kinds: kinds as OwnerDocKind[] | undefined })
    console.log(`Rejected ${userId} (${third})`)
  } else if (cmd === 'reset' && userId) {
    await resetOwner(prisma, userId)
    console.log(`Attempts reset for ${userId}`)
  } else {
    console.error('Usage: list | show <userId> | approve <userId> | reject <userId> <CODE> ["note"] [--kinds=KTP,SHM] | reset <userId>')
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
