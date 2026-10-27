import {test,expect} from './safe-fixtures'
import {newOwnerWorld,newStudent,hold,sql} from '../tests/seams'
test('D3 add and remove unused room, archive historical room',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'audit-rooms',rooms:1})
 const student=await newStudent(browser,{label:'audit-rooms-student'})
 try {
  const held=await hold(owner,student,owner.rooms[0].id)
  await sql(`UPDATE "Tenancy" SET status='ENDED',"endedAt"=now() WHERE id=$1`,[held.tenancyId])
  const p=owner.page;await p.goto(`/owner/kos?kos=${owner.kosId}`)
  await p.getByRole('button',{name:'Tambah kamar'}).click()
  const d=p.getByRole('dialog');await d.getByLabel('Nomor / Nama Kamar').fill('AUDIT-999')
  await d.getByLabel('Lantai Gedung').fill('1');await d.getByLabel('Ukuran Kamar').fill('3 x 4 m')
  await d.getByLabel('Tipe Kamar').fill('Audit');await d.getByLabel('Tipe Kasur').fill('Single')
  await d.getByLabel('Harga Sewa Bulanan (Rp)').fill('1500000')
  await d.getByRole('button',{name:'Simpan Kamar'}).click()
  const row=p.getByRole('row').filter({hasText:'AUDIT-999'});await expect(row).toBeVisible()
  const [added]=await sql<{id:string}>(`SELECT id FROM "Room" WHERE "kosId"=$1 AND "roomNumber"=$2`,[owner.kosId,'AUDIT-999'])
  await row.getByRole('button',{name:/Aksi Kamar/}).click();await p.getByRole('menuitem',{name:'Hapus kamar'}).click()
  await p.getByRole('alert').getByRole('button',{name:'Hapus',exact:true}).click()
  await expect(row).toHaveCount(0);expect(await sql('SELECT id FROM "Room" WHERE id=$1',[added.id])).toHaveLength(0)
  const historic=p.getByRole('row').filter({hasText:`${owner.rooms[0].roomNumber}`}).first()
  await historic.getByRole('button',{name:/Aksi Kamar/}).click();await p.getByRole('menuitem',{name:'Hapus kamar'}).click()
  await p.getByRole('alert').getByRole('button',{name:'Hapus',exact:true}).click()
  await expect(p.getByText('Kamar diarsipkan. Riwayat sewa dan pembayarannya tetap tersimpan.')).toBeVisible()
  const [r]=await sql<{archived:boolean}>(`SELECT "archivedAt" IS NOT NULL AS archived FROM "Room" WHERE id=$1`,[owner.rooms[0].id]);expect(r.archived).toBe(true)
  expect(await sql('SELECT id FROM "Tenancy" WHERE id=$1',[held.tenancyId])).toHaveLength(1)
  await p.reload();await expect(p.getByRole('row').filter({hasText:'AUDIT-999'})).toHaveCount(0)
 } finally {await owner.ctx.close();await student.ctx.close()}
})
test('D9 archive property with rental history',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'audit-archive',rooms:1})
 const student=await newStudent(browser,{label:'audit-archive-student'})
 try {
  const held=await hold(owner,student,owner.rooms[0].id)
  await sql(`UPDATE "Tenancy" SET status='ENDED',"endedAt"=now() WHERE id=$1`,[held.tenancyId])
  const p=owner.page;await p.goto(`/owner/kos?kos=${owner.kosId}`)
  await p.getByRole('button',{name:'Aksi lainnya'}).first().click()
  await p.getByRole('menuitem',{name:'Hapus kos'}).click()
  await p.getByRole('alert').getByRole('button',{name:'Hapus',exact:true}).click()
  await expect(p.getByText('Properti kos diarsipkan. Riwayat sewa dan pembayarannya tetap tersimpan.')).toBeVisible()
  const [r]=await sql<{archived:boolean}>(`SELECT "archivedAt" IS NOT NULL AS archived FROM "Kos" WHERE id=$1`,[owner.kosId]);expect(r.archived).toBe(true)
  expect(await sql('SELECT id FROM "Tenancy" WHERE id=$1',[held.tenancyId])).toHaveLength(1)
 } finally {await owner.ctx.close();await student.ctx.close()}
})
