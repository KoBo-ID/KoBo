import {test,expect} from './safe-fixtures'
import {newOwnerWorld,newStudent,hold} from '../tests/seams'
import {writeFileSync} from 'node:fs'
test('F4 priority interaction timings',async({browser})=>{
 test.setTimeout(150000)
 const data:{action:string;ms:number;sample:number}[]=[]
 async function measure(sample:number,action:string,fn:()=>Promise<void>){const t=performance.now();await fn();data.push({action,ms:performance.now()-t,sample});writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/perf-actions.json',JSON.stringify(data,null,2))}
 for(let n=1;n<=3;n++){
  const owner=await newOwnerWorld(browser,{label:`perf-owner-${n}`,rooms:2})
  const student=await newStudent(browser,{label:`perf-student-${n}`,demo:true})
  const manual=await newStudent(browser,{label:`perf-manual-${n}`})
  try {
   const p=student.page
   await p.goto('/search');await p.getByRole('combobox',{name:'Cari lokasi'}).fill('tidak-ada-audit')
   await measure(n,'submit search',async()=>{await p.getByRole('button',{name:'Cari',exact:true}).click();await expect(p.getByText('Tidak ada kos yang cocok')).toBeVisible()})
   await p.goto(`/kos/${owner.kosId}`);await p.getByRole('button',{name:'Ajukan Sewa'}).click()
   await p.getByLabel('Pekerjaan atau kegiatan utama').fill('Mahasiswa performa')
   await measure(n,'submit application',async()=>{await p.getByRole('button',{name:'Kirim Pengajuan'}).click();await expect(p.getByRole('heading',{name:'Pengajuan Terkirim'})).toBeVisible()})
   const o=owner.page;await o.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
   const app=o.getByTestId('owner-application').filter({hasText:'Mahasiswa performa'})
   await app.getByRole('button',{name:'Terima'}).click()
   await measure(n,'approve application',async()=>{await o.getByRole('dialog').getByRole('button',{name:'Terima Pengajuan'}).click();await expect(app).toHaveCount(0)})
   await p.goto('/my-kos');const card=p.getByTestId('tenancy-card').filter({hasText:owner.kosName})
   await measure(n,'start mock payment',async()=>{await card.getByRole('button',{name:'Bayar Sekarang'}).click();await expect(p.getByRole('button',{name:'Selesaikan Pembayaran'})).toBeVisible()})
   await measure(n,'settle mock payment',async()=>{await p.getByRole('button',{name:'Selesaikan Pembayaran'}).click();await expect(card).toHaveAttribute('data-status','ACTIVE')})
   await hold(owner,manual,owner.rooms[1].id)
   await o.goto(`/owner/dashboard?kos=${owner.kosId}`)
   const row=o.getByRole('row').filter({hasText:`Kamar ${owner.rooms[1].roomNumber}`})
   await row.getByRole('button',{name:`Tandai Lunas Kamar ${owner.rooms[1].roomNumber}`}).click()
   const dialog=o.getByRole('dialog');const label=await dialog.getByText(/Ketik jumlah yang diterima/).first().textContent()
   const amount=label?.match(/Rp\s*([\d.]+)/)?.[1].replace(/\./g,'');if(!amount)throw Error('Amount not available')
   await dialog.getByLabel(/Ketik jumlah yang diterima/).fill(amount)
   await measure(n,'mark cash paid',async()=>{await dialog.getByRole('button',{name:'Catat Lunas'}).click();await expect(row.getByText('Lunas',{exact:true})).toBeVisible()})
  } finally {await owner.ctx.close();await student.ctx.close();await manual.ctx.close()}
 }
})
