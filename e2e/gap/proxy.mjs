// Logging reverse proxy for the coverage measurement: listens on :3100, forwards to the real server on :3101 and appends one
// JSON line per API request (and per hashed asset, to derive visited routes) to notes/gap-tests/coverage/<LOG>.jsonl.
// Headers and cookies pass through untouched (the server's origin check compares against BETTER_AUTH_URL = http://localhost:3100).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const LISTEN = Number(process.env.PROXY_PORT ?? 3100)
const TARGET = Number(process.env.TARGET_PORT ?? 3101)
const logFile = path.join(root, 'notes/gap-tests/coverage', process.env.PROXY_LOG ?? 'old-requests.jsonl')
fs.mkdirSync(path.dirname(logFile), { recursive: true })
fs.writeFileSync(logFile, '')
const out = fs.createWriteStream(logFile, { flags: 'a' })
const logged = /^\/(api\/(trpc|auth|webhooks|__e2e)\/|assets\/)/

http
  .createServer((req, res) => {
    const started = Date.now()
    const pathname = (req.url ?? '').split('?')[0]
    const upstream = http.request({ host: '127.0.0.1', port: TARGET, method: req.method, path: req.url, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
      const chunks = []
      if ((up.statusCode ?? 0) >= 400) up.on('data', (c) => chunks.length < 8 && chunks.push(c))
      up.on('end', () => {
        if (!logged.test(pathname)) return
        let msg
        if (chunks.length) {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString())
            msg = j?.error?.json?.message ?? j?.error?.message ?? j?.message
          } catch {
            /* not JSON */
          }
        }
        out.write(JSON.stringify({ t: started, method: req.method, path: pathname, status: up.statusCode, ms: Date.now() - started, ...(msg ? { msg } : {}) }) + '\n')
      })
    })
    upstream.on('error', (e) => {
      res.writeHead(502)
      res.end(String(e))
    })
    req.pipe(upstream)
  })
  .listen(LISTEN, () => console.log(`proxy ${LISTEN} -> ${TARGET}, log ${logFile}`))
