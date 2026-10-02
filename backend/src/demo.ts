/** Seeded demo accounts (see db/seed.ts). They have no password; sessions come from POST /api/auth/demo-login. */
export const DEMO_EMAILS = {
  student: 'demo-student@kobo.test',
  owner: 'demo-owner@kobo.test',
} as const

export type DemoPersona = keyof typeof DEMO_EMAILS
