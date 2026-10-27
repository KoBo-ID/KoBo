import {test,expect} from './safe-fixtures'
import {newOwnerWorld,newStudent,trpcRaw} from '../tests/seams'
test('C3 consent-enforced UI and server refusal agree',async({browser})=>{
 const owner=await newOwnerWorld(browser,{label:'consent-owner',rooms:1})
 const student=await newStudent(browser,{label:'consent-student'})
 try {
  const page=student.page
  await page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
  await expect(page.getByText(/Sebelum mengajukan sewa, lengkapi kontak darurat/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Kirim Pengajuan'})).toBeDisabled()
  const startDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
  const response=await trpcRaw(student.ctx,'application.create',{roomId:owner.rooms[0].id,startDate,durationMonths:3,occupation:'Mahasiswa'})
  expect(response.code).toBe('PRECONDITION_FAILED')
  expect(response.message).toContain('Lengkapi kontak darurat')
 } finally {await owner.ctx.close();await student.ctx.close()}
})
