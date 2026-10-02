import { DEMO_EMAILS } from './demo.ts'
import type { PrismaClient } from './db/client.ts'
import { buildSeed } from './db/seed.ts'

/*
 * Spec section 5: the shared demo accounts get vandalised, so a reset puts back ONLY what they own, and real
 * sign-ups are never touched.
 *
 * Demo-owned state:
 *  - everything the demo student has: tenancies (with invoices, payments, review), visits, waitlist entries, profile fields;
 *  - the demo owner's profile, kos (edits, rooms, photos, rules, POIs, new kos), and the seeded tenants,
 *    invoices, payments and reviews of those kos (owner actions such as "Tandai Lunas", move-out and
 *    review replies all land there).
 * Never touched: other owners, real users' tenancies / reviews / visits, sessions, accounts.
 * A real user's live tenancy in a demo kos room wins over the seeded tenant that used to live there.
 */

let running: Promise<void> = Promise.resolve()

/** Serialised: two overlapping resets (nightly + a button press) run one after the other. */
export function resetDemo(prisma: PrismaClient, now: Date = new Date()): Promise<void> {
  const run = running.then(() => doReset(prisma, now))
  running = run.catch(() => undefined)
  return run
}

const LIVE = ['PENDING', 'ACTIVE'] as const

async function doReset(prisma: PrismaClient, now: Date): Promise<void> {
  const seed = buildSeed(now)
  const demoStudent = seed.users.find((u) => u.email === DEMO_EMAILS.student)!
  const demoOwnerUser = seed.users.find((u) => u.email === DEMO_EMAILS.owner)!
  const demoProfile = seed.ownerProfiles.find((p) => p.userId === demoOwnerUser.id)!
  const seedKos = seed.kos.filter((k) => k.ownerId === demoProfile.id)
  const seedKosIds = seedKos.map((k) => k.id)
  const inKos = <T extends { kosId: string }>(rows: T[]) => rows.filter((r) => seedKosIds.includes(r.kosId))
  const seedUserIds = seed.users.map((u) => u.id)
  const seedRooms = inKos(seed.rooms)
  const seedRoomIds = seedRooms.map((r) => r.id)

  await prisma.$transaction(
    async (tx) => {
      // 1. Demo student: visits and (below) tenancies.
      await tx.visit.deleteMany({ where: { userId: demoStudent.id } })

      // 2. Kos the demo owner added (cascades rooms, tenancies, photos, ...).
      await tx.kos.deleteMany({ where: { ownerId: demoProfile.id, id: { notIn: seedKosIds } } })

      // 3. Tenancies in scope: the demo student's anywhere, and seeded tenants' in the demo owner's kos.
      const scope = { OR: [{ userId: demoStudent.id }, { userId: { in: seedUserIds }, room: { kosId: { in: seedKosIds } } }] }
      const doomed = await tx.tenancy.findMany({ where: scope, select: { roomId: true } })
      await tx.tenancy.deleteMany({ where: scope })

      // 3b. Daftar tunggu entries in the same scope: the demo student's anywhere, and seeded users' on the demo owner's kos.
      await tx.waitlistEntry.deleteMany({ where: { OR: [{ userId: demoStudent.id }, { userId: { in: seedUserIds }, kosId: { in: seedKosIds } }] } })

      // 4. The demo owner's kos back to seed: fields, photos, rules, POIs.
      for (const { id, ...fields } of seedKos) await tx.kos.update({ where: { id }, data: fields as never })
      await tx.kosImage.deleteMany({ where: { kosId: { in: seedKosIds } } })
      await tx.houseRule.deleteMany({ where: { kosId: { in: seedKosIds } } })
      await tx.poi.deleteMany({ where: { kosId: { in: seedKosIds } } })
      await tx.kosImage.createMany({ data: inKos(seed.images) as never })
      await tx.houseRule.createMany({ data: inKos(seed.rules) as never })
      await tx.poi.createMany({ data: inKos(seed.pois) as never })

      // 5. Rooms: drop the ones the owner added (unless a real user rents them), restore the seeded ones.
      await tx.room.deleteMany({ where: { kosId: { in: seedKosIds }, id: { notIn: seedRoomIds }, tenancies: { none: {} } } })
      for (const { id, ...fields } of seedRooms) await tx.room.upsert({ where: { id }, create: { id, ...fields } as never, update: fields as never })

      // 6. Seeded tenants come back, except into a room a real user holds now.
      const held = new Set(
        (await tx.tenancy.findMany({ where: { roomId: { in: seedRoomIds }, status: { in: [...LIVE] } }, select: { roomId: true } })).map((t) => t.roomId),
      )
      const tenancies = seed.tenancies.filter((t) => seedRoomIds.includes(t.roomId) && !(t.status !== 'ENDED' && held.has(t.roomId)))
      const tenancyIds = new Set(tenancies.map((t) => t.id))
      const invoices = seed.invoices.filter((i) => tenancyIds.has(i.tenancyId))
      const invoiceIds = new Set(invoices.map((i) => i.id))
      await tx.tenancy.createMany({ data: tenancies as never })
      await tx.invoice.createMany({ data: invoices as never })
      await tx.payment.createMany({ data: seed.payments.filter((p) => invoiceIds.has(p.invoiceId)) as never })
      await tx.review.createMany({ data: seed.reviews.filter((r) => tenancyIds.has(r.tenancyId)) as never })

      // 7. The demo accounts' own profile fields.
      for (const u of [demoStudent, demoOwnerUser]) {
        await tx.user.update({
          where: { id: u.id },
          data: {
            name: u.name as string,
            image: (u.image as string | undefined) ?? null,
            phone: (u.phone as string | undefined) ?? null,
            campus: (u.campus as string | undefined) ?? null,
            campusEmail: (u.campusEmail as string | undefined) ?? null,
            campusEmailVerifiedAt: (u.campusEmailVerifiedAt as Date | undefined) ?? null,
          },
        })
      }
      const { id: _id, userId: _userId, ...profileFields } = demoProfile
      await tx.ownerProfile.update({ where: { id: demoProfile.id }, data: profileFields as never })

      // 8. Room occupancy follows the tenancies again for every room this reset could have changed.
      const touched = [...new Set([...doomed.map((d) => d.roomId), ...seedRoomIds])]
      await tx.$executeRaw`
        UPDATE "Room" r SET occupancy = CASE
          WHEN EXISTS (SELECT 1 FROM "Tenancy" t WHERE t."roomId" = r.id AND t.status = 'ACTIVE') THEN 'OCCUPIED'::"Occupancy"
          WHEN EXISTS (SELECT 1 FROM "Tenancy" t WHERE t."roomId" = r.id AND t.status = 'PENDING' AND t."expiresAt" > ${now}) THEN 'BOOKED'::"Occupancy"
          ELSE 'VACANT'::"Occupancy" END
        WHERE r.id = ANY(${touched})`
    },
    { timeout: 60_000, maxWait: 10_000 },
  )
}
