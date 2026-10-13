// Real-Resend smoke test. NOT run in CI: it sends one real email and spends Resend quota.
//
//   npm run email:smoke -w backend -- you@example.com
//
// Reads RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO and BETTER_AUTH_URL from the environment (backend/.env when run
// from backend/). Lists the account's Resend domains, warns when EMAIL_FROM is not on a verified one, then renders
// the real 'verify-email' template with a sample link on BETTER_AUTH_URL and sends it through resendTransport.
// The sample token is fake: the link shows where real links will point, it does not verify anything.
import '../src/env.ts'
import { renderEmail } from '../src/emailTemplates.ts'
import { isResendTestSender, ResendError, resendTransport } from '../src/outbox.ts'

const recipient = process.argv[2]?.trim()
if (!recipient || !recipient.includes('@')) {
  console.error('Usage: npm run email:smoke -w backend -- <recipient@example.com>')
  console.error('Refusing to run without a recipient: this sends one real email through Resend.')
  process.exit(2)
}

const apiKey = process.env.RESEND_API_KEY?.trim()
const from = process.env.EMAIL_FROM?.trim()
const baseURL = (process.env.BETTER_AUTH_URL ?? '').trim().replace(/\/+$/, '')
const missing = [!apiKey && 'RESEND_API_KEY', !from && 'EMAIL_FROM', !baseURL && 'BETTER_AUTH_URL'].filter(Boolean)
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')} (set them in the environment or backend/.env).`)
  process.exit(2)
}

console.log(`From:            ${from}`)
console.log(`To:              ${recipient}`)
console.log(`BETTER_AUTH_URL: ${baseURL}`)
if (!/^https:\/\//.test(baseURL) || /\/\/(localhost|127\.0\.0\.1)\b/.test(baseURL)) {
  console.warn('WARNING: BETTER_AUTH_URL is not a public https origin; links in real emails would not open for users.')
}

// 1. Domains. A sending-only key gets 401/403 here; that is fine, carry on.
const fromDomain = /@([^>\s]+)>?\s*$/.exec(from!)?.[1]?.toLowerCase()
try {
  const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) })
  if (res.status === 401 || res.status === 403) {
    console.log(`\nDomains: this API key cannot list domains (${res.status}); skipping the domain check.`)
  } else if (!res.ok) {
    console.log(`\nDomains: Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`)
  } else {
    const { data = [] } = (await res.json()) as { data?: { name: string; status: string }[] }
    console.log('\nDomains:')
    if (data.length === 0) console.log('  (none)')
    for (const d of data) console.log(`  ${d.name}  ${d.status}`)
    const verified = data.filter((d) => d.status === 'verified').map((d) => d.name.toLowerCase())
    if (fromDomain && !verified.includes(fromDomain)) {
      console.warn(`WARNING: EMAIL_FROM's domain "${fromDomain}" is not a verified domain on this account.`)
    }
  }
} catch (err) {
  console.log(`\nDomains: request failed (${err instanceof Error ? err.message : String(err)}); continuing.`)
}
if (isResendTestSender(from!)) {
  console.warn("WARNING: onboarding@resend.dev is Resend's test sender: it only delivers to the account owner and lands in spam.")
}

// 2. Send the real template. Capture Resend's response id through a wrapped fetch.
const rendered = renderEmail('verify-email', {
  name: 'Penguji KoBo',
  url: `${baseURL}/api/auth/verify-email?token=SMOKE-TEST-TOKEN&callbackURL=%2Fverifikasi-email`,
})!
let responseBody = ''
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  responseBody = await res.clone().text()
  return res
}
const transport = resendTransport({ apiKey: apiKey!, from: from!, replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined, fetch: recordingFetch })
try {
  await transport.send({ to: recipient, ...rendered })
  const id = (JSON.parse(responseBody || '{}') as { id?: string }).id
  console.log(`\nSent. Resend id: ${id ?? '(none in response)'}  (check Resend -> Emails for delivery status)`)
} catch (err) {
  if (err instanceof ResendError) console.error(`\nSend failed: status ${err.status}\n${err.body}`)
  else console.error(`\nSend failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
