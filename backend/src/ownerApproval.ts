/**
 * New owners wait for approval before their kos appear publicly (they can set everything up meanwhile).
 * OWNER_AUTO_APPROVE is a comma-separated list of exact emails or "@domain" suffixes that skip the wait, for the team and demos.
 * Anyone else is approved with `npm run owners:approve -w backend -- <email>`.
 */
export function isAutoApproved(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const rules = (env.OWNER_AUTO_APPROVE ?? '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  const mail = email.trim().toLowerCase()
  return rules.some((r) => (r.startsWith('@') ? mail.endsWith(r) : mail === r))
}
