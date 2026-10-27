import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const source = readFileSync('e2e/start-server.mjs', 'utf8')
const match = source.match(/process\.env\.E2E_DATABASE_URL \?\? '([^']+)'/)
if (!match) throw new Error('Missing E2E default')
const target = new URL(process.env.E2E_DATABASE_URL || match[1])
target.hostname = process.env.E2E_DATABASE_URL ? target.hostname : '127.0.0.1'
if (target.hostname !== '127.0.0.1' || target.port !== '5433' || target.pathname !== '/kobo_e2e') throw new Error('Unsafe database target')
console.log(`DB host=${target.hostname} port=${target.port} name=${target.pathname.slice(1)}`)
const env = { ...process.env, E2E_DATABASE_URL: target.href, E2E_PORT: '3100', R2_ENDPOINT: '', R2_PUBLIC_BUCKET: '', R2_PUBLIC_ACCESS_KEY_ID: '', R2_PUBLIC_SECRET_ACCESS_KEY: '', R2_PUBLIC_BASE_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', RESEND_API_KEY: '', GEOCODER: 'off', PAYMENT_PROVIDER: 'mock', FRONTEND_DIST: '' }
delete env.FRONTEND_DIST
const child = spawn(process.execPath, ['e2e/start-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
// Logs may include verification links and account details; retain only startup lifecycle markers.
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
  const text = String(data)
  if (/KoBo server listening/.test(text)) console.log('KoBo server listening on port 3100')
  else if (/Error|error|failed/i.test(text)) console.log(text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE_URL]').replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\w.+-]+@[\w.-]+/g, '[EMAIL]'))
})
child.on('exit', code => { console.log(`Server exited with code ${code}`); process.exitCode = code ?? 1 })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))

