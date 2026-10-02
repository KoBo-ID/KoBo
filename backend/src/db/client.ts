import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'

export type { PrismaClient }

export function createPrisma(connectionString: string): PrismaClient {
  // Pin the session to UTC: Prisma sends DateTime parameters as UTC text without an offset, so a
  // server whose default timezone is not UTC would silently shift every timestamptz by that offset.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, options: '-c timezone=UTC' }) })
}
