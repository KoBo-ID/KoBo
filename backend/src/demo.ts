/** Seeded demo accounts (see db/seed.ts). They have no password; sessions come from POST /api/auth/demo-login. */
export const DEMO_EMAILS = {
  student: 'dimas.pratama@kobo.test',
  owner: 'ratna.hendrawan@kobo.test',
  temanA: 'nadia.putri@kobo.test',
  temanB: 'clara.wijaya@kobo.test',
} as const

export type DemoPersona = keyof typeof DEMO_EMAILS

export const DEMO_STUDENT_EMAILS = [DEMO_EMAILS.student, DEMO_EMAILS.temanA, DEMO_EMAILS.temanB] as const
export const DEMO_TEMAN_CONNECTION_ID = 'match-conn-demo-teman'
