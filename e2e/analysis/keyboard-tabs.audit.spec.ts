import {test,expect,type Page,type Locator} from './safe-fixtures'
import {ownIp} from '../tests/accounts'
import {newOwnerWorld,newStudent} from '../tests/seams'
async function tabTo(page:Page,target:Locator){
 await expect(target).toBeVisible()
 for(let i=0;i<100;i++){if(await target.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab')}
 throw Error('Target not reachable within 100 Tab presses')
}
test('F2 tab traversal for sign in, application and approval',async({page,browser,problems})=>{
 await ownIp(page);await page.goto('/masuk')
 const email=page.getByLabel('Email');await tabTo(page,email);await expect(email).toBeFocused();await page.keyboard.type('tidak-ada@example.com')
 const password=page.getByLabel('Kata Sandi');await tabTo(page,password);await page.keyboard.type('salah-salah-1')
 const submit=page.getByRole('button',{name:'Masuk ke Akun'});await tabTo(page,submit);await page.keyboard.press('Enter')
 await expect(page.getByRole('alert')).toContainText('Email atau kata sandi salah');problems.splice(0,problems.length,...problems.filter(x=>!x.includes('401')))
 const owner=await newOwnerWorld(browser,{label:'audit-tab-owner',rooms:1});const student=await newStudent(browser,{label:'audit-tab-student'})
 try {
  const p=student.page;await p.goto(`/kos/${owner.kosId}`)
  const apply=p.getByRole('button',{name:'Ajukan Sewa'});await tabTo(p,apply);await p.keyboard.press('Enter')
  const occupation=p.getByLabel('Pekerjaan atau kegiatan utama');await tabTo(p,occupation);await p.keyboard.type('Mahasiswa tab')
  const send=p.getByRole('button',{name:'Kirim Pengajuan'});await tabTo(p,send);await p.keyboard.press('Enter')
  await expect(p.getByRole('heading',{name:'Pengajuan Terkirim'})).toBeVisible()
  const op=owner.page;await op.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
  const row=op.getByTestId('owner-application').filter({hasText:'Mahasiswa tab'});const accept=row.getByRole('button',{name:'Terima'})
  await tabTo(op,accept);await op.keyboard.press('Enter')
  const confirm=op.getByRole('dialog').getByRole('button',{name:'Terima Pengajuan'});await tabTo(op,confirm);await op.keyboard.press('Enter')
  await expect(row).toHaveCount(0)
 } finally {await owner.ctx.close();await student.ctx.close()}
})
