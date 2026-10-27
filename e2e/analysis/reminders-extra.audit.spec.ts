import {test,expect} from './safe-fixtures'
import {newOwnerWorld,newStudent,hold,sql,tick,hook} from '../tests/seams'
test('E4 quiet hours, reminder outbox and consented emergency contact',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'notify-complete-owner',rooms:2})
 const yes=await newStudent(browser,{label:'notify-complete-yes'})
 const no=await newStudent(browser,{label:'notify-complete-no'})
 try {
  const one=await hold(owner,yes,owner.rooms[0].id);const two=await hold(owner,no,owner.rooms[1].id)
  await sql(`UPDATE "Tenancy" SET status='ACTIVE' WHERE id=ANY($1)`,[[one.tenancyId,two.tenancyId]])
  await sql(`UPDATE "Invoice" SET "dueDate"=(now() AT TIME ZONE 'Asia/Jakarta')::date+30 WHERE id=ANY($1)`,[[one.invoiceId,two.invoiceId]])
  await sql(`UPDATE "User" SET phone=$2,"emergencyContactName"=$3,"emergencyContactPhone"=$4,"emergencyContactConsentAt"=now() WHERE id=$1`,[yes.userId,'081200000031','Kontak Uji','081200000032'])
  await sql(`UPDATE "User" SET "emergencyContactName"=$2,"emergencyContactPhone"=$3,"emergencyContactConsentAt"=NULL WHERE id=$1`,[no.userId,'Kontak Tanpa Izin','081200000033'])
  const [{d}]=await sql<{d:string}>(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)
  const quiet=await tick(owner.ctx,'notify',new Date(`${d}T22:00:00+07:00`)) as {skippedQuietHours:boolean}
  expect(quiet.skippedQuietHours).toBe(true)
  await sql(`UPDATE "Invoice" SET "dueDate"=(now() AT TIME ZONE 'Asia/Jakarta')::date+1 WHERE id=$1`,[one.invoiceId])
  await tick(owner.ctx,'notify',new Date(`${d}T10:00:00+07:00`))
  const email=await sql<{payload:{url?:string}}>(`SELECT payload FROM "EmailOutbox" WHERE "to"=$1 AND template='invoice-reminder'`,[yes.email])
  expect(email).toHaveLength(1);expect(email[0].payload.url).toContain('/my-kos')
  await sql(`UPDATE "Invoice" SET "dueDate"=(now() AT TIME ZONE 'Asia/Jakarta')::date-7 WHERE id=ANY($1)`,[[one.invoiceId,two.invoiceId]])
  await tick(owner.ctx,'notify',new Date(`${d}T11:00:00+07:00`))
  await tick(owner.ctx,'notify',new Date(`${d}T12:00:00+07:00`))
  const logs=await sql<{invoiceId:string;kind:string}>(`SELECT "invoiceId",kind FROM "NotificationLog" WHERE "invoiceId"=ANY($1) AND kind='EMERGENCY_CONTACT'`,[[one.invoiceId,two.invoiceId]])
  expect(logs).toEqual([{invoiceId:one.invoiceId,kind:'EMERGENCY_CONTACT'}])
  const messages=await hook<{to:string;kind:string;text:string}[]>(owner.ctx,'whatsapp',{})
  const m=messages.filter(x=>x.to==='081200000032'&&x.kind==='EMERGENCY_CONTACT')
  expect(m.length).toBeGreaterThanOrEqual(1);expect(m.at(-1)?.text).toContain('BERHENTI');expect(m.at(-1)?.text).not.toMatch(/Rp\s*\d/)
 } finally {await owner.ctx.close();await yes.ctx.close();await no.ctx.close()}
})
