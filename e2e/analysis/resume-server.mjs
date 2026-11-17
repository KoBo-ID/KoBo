import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import net from 'node:net'
const source = readFileSync('e2e/start-server.mjs', 'utf8')
const dbMatch = source.match(/process\.env\.E2E_DATABASE_URL \?\? '([^']+)'/)
const secretMatch = source.match(/process\.env\.BETTER_AUTH_SECRET \?\? '([^']+)'/)
if (!dbMatch || !secretMatch) throw Error('E2E defaults unavailable')
const target = new URL(process.env.E2E_DATABASE_URL || dbMatch[1])
if (!process.env.E2E_DATABASE_URL) target.hostname='127.0.0.1'
if (target.hostname!=='127.0.0.1'||target.port!=='5433'||target.pathname!=='/kobo_e2e') throw Error('Unsafe database target')
console.log(`DB host=${target.hostname} port=${target.port} name=${target.pathname.slice(1)}`)
const db = new Client({connectionString:target.href,connectionTimeoutMillis:3000})
await db.connect()
try { const r = await db.query('SELECT current_database() AS name'); if(r.rows[0].name !== 'kobo_e2e') throw Error('Wrong database'); console.log('Connected database name verified') } finally { await db.end() }
await new Promise((resolve,reject)=>{ const s=net.createServer();s.once('error',reject);s.listen(3100,'127.0.0.1',()=>s.close(resolve)) })
const env={...process.env,NODE_ENV:'production',DATABASE_URL:target.href,E2E_DATABASE_URL:target.href,PORT:'3100',BETTER_AUTH_URL:'http://localhost:3100',BETTER_AUTH_SECRET:process.env.BETTER_AUTH_SECRET || secretMatch[1],ALLOW_INSECURE_AUTH_URL:'1',ALLOW_FAKE_STORAGE:'1',PAYMENT_PROVIDER:'mock',ALLOW_MOCK_PAYMENTS:'1',PAYMENT_RETURN_ORIGIN:'',ALLOW_E2E_HOOKS:'1',RESEND_API_KEY:'',ALLOW_CONSOLE_EMAIL:'1',GEOCODER:'off',REQUIRE_PROFILE_CONSENTS:process.env.AUDIT_CONSENT === '1' ? '1' : '0',R2_ENDPOINT:'',R2_PUBLIC_BUCKET:'',R2_PUBLIC_ACCESS_KEY_ID:'',R2_PUBLIC_SECRET_ACCESS_KEY:'',R2_PUBLIC_BASE_URL:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',XENDIT_MODE:'test'}
delete env.FRONTEND_DIST
const child=spawn(process.execPath,['src/index.ts'],{cwd:'backend',env,stdio:['ignore','pipe','pipe']})
for (const stream of [child.stdout,child.stderr]) stream.on('data',data=>{const text=String(data);if(/KoBo server listening/.test(text)) console.log('KoBo server listening on port 3100');else if(/Error|error|failed/i.test(text)) console.log(text.replace(/postgres(?:ql)?:\/\/\S+/gi,'[DATABASE_URL]').replace(/https?:\/\/\S+/gi,'[URL]').replace(/[\w.+-]+@[\w.-]+/g,'[EMAIL]'))})
child.on('exit',code=>{console.log(`Server exited with code ${code}`);process.exitCode=code??1})
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>child.kill(sig))
