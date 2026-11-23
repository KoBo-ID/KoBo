import pg from 'pg'

const target = 'kobo_e2e_flow_audit'
const conn = process.env.PG_ADMIN_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/postgres'
const c = new pg.Client({ connectionString: conn })
await c.connect()
try {
  const r = await c.query('SELECT datname FROM pg_database WHERE datname = $1', [target])
  if (r.rowCount === 0) {
    await c.query(`CREATE DATABASE "${target}"`)
    console.log(`CREATED ${target}`)
  } else {
    console.log(`EXISTS ${target}`)
  }
  const all = await c.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname')
  console.log('DBS:', all.rows.map((x) => x.datname).join(', '))
} finally {
  await c.end()
}
