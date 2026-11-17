import {test,expect} from './safe-fixtures'
import {newOwnerWorld,newStudent,hold,sql,trpcRaw,trpcPost} from '../tests/seams'
test('D3 room edit survives reload',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'audit-edit-room',rooms:1})
 try {const p=owner.page;await p.goto(`/owner/kos?kos=${owner.kosId}`)
  await p.getByRole('button',{name:/Aksi Kamar/}).first().click();await p.getByRole('menuitem',{name:'Edit kamar'}).click()
  await p.getByLabel('Tipe Kamar').fill('Audit Persisten');await p.getByRole('button',{name:'Simpan Perubahan'}).click()
  await expect(p.getByRole('row').filter({hasText:'Audit Persisten'})).toBeVisible();await p.reload()
  await expect(p.getByRole('row').filter({hasText:'Audit Persisten'})).toBeVisible()
 } finally {await owner.ctx.close()}
})
test('D9 active tenancy blocks deletion; unused property can be deleted',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'audit-delete-busy',rooms:1})
 const student=await newStudent(browser,{label:'audit-delete-student'})
 const unused=await newOwnerWorld(browser,{label:'audit-delete-unused',rooms:1})
 try {
  await hold(owner,student,owner.rooms[0].id)
  const r=await trpcRaw(owner.ctx,'owner.kos.delete',{kosId:owner.kosId});expect(r.code).toBe('CONFLICT')
  expect(await sql('SELECT id FROM "Kos" WHERE id=$1',[owner.kosId])).toHaveLength(1)
  const p=unused.page;await p.goto(`/owner/kos?kos=${unused.kosId}`);await p.getByRole('button',{name:'Aksi lainnya'}).first().click()
  await p.getByRole('menuitem',{name:'Hapus kos'}).click();await p.getByRole('alert').getByRole('button',{name:'Hapus',exact:true}).click()
  await expect(p.getByText('Properti kos telah dihapus.')).toBeVisible()
  expect(await sql('SELECT id FROM "Kos" WHERE id=$1',[unused.kosId])).toHaveLength(0)
 } finally {await owner.ctx.close();await student.ctx.close();await unused.ctx.close()}
})
test('D2 owner and room limits enforced against isolated fixtures',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'audit-limits',rooms:40})
 try {
  const room=await trpcRaw(owner.ctx,'owner.room.create',{kosId:owner.kosId,roomNumber:'AUDIT-X',floor:1,type:'Audit',size:'3x4',bedType:'Single',priceMonthly:1500000})
  expect(room.code).toBe('CONFLICT');expect(room.message).toContain('40')
  const base={gender:'CAMPUR',address:'Jl. Audit No. 1',district:'Kebayoran Baru',city:'Jakarta Selatan',lat:-6.2,lng:106.8,electricityType:'INCLUDED',privateAmenities:[],sharedAmenities:[],studentDiscountAmount:0,initialRooms:{count:1,priceMonthly:1500000}}
  const [{ownerId}]=await sql<{ownerId:string}>(`SELECT "ownerId" FROM "Kos" WHERE id=$1`,[owner.kosId])
  for(let i=0;i<4;i++){const other=await newOwnerWorld(browser,{label:`audit-limit-extra-${i}`,rooms:1});await sql(`UPDATE "Kos" SET "ownerId"=$1 WHERE id=$2`,[ownerId,other.kosId]);await other.ctx.close()}
  const tooMany=await trpcRaw(owner.ctx,'owner.kos.create',{...base,name:'Audit Limit Extra'})
  expect(tooMany.code).toBe('CONFLICT');expect(tooMany.message).toContain('5')
 } finally {await owner.ctx.close()}
})
