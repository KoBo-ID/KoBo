import {test,expect} from './safe-fixtures'
import {ownIp} from '../tests/accounts'
import {newOwnerWorld,newStudent,apply} from '../tests/seams'

test('F2 keyboard sign in, application and owner approval',async({page,browser,problems})=>{
 await ownIp(page); await page.goto('/masuk')
 const email=page.getByLabel('Email'); await email.focus(); await page.keyboard.type('tidak-ada@example.com')
 await page.keyboard.press('Tab'); await expect(page.getByLabel('Kata Sandi')).toBeFocused()
 await page.keyboard.type('salah-salah-1')
 const submit=page.getByRole('button',{name:'Masuk ke Akun'});await submit.focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('alert')).toContainText('Email atau kata sandi salah')
 problems.splice(0,problems.length,...problems.filter(p=>!p.includes('401')))
 const owner=await newOwnerWorld(browser,{label:'keyboard-owner',rooms:2})
 const student=await newStudent(browser,{label:'keyboard-student'})
 try {
  await student.page.goto(`/kos/${owner.kosId}`)
  const applyButton=student.page.getByRole('button',{name:'Ajukan Sewa'});await applyButton.focus();await student.page.keyboard.press('Enter')
  const occupation=student.page.getByLabel('Pekerjaan atau kegiatan utama');await occupation.focus();await student.page.keyboard.type('Mahasiswa keyboard')
  const send=student.page.getByRole('button',{name:'Kirim Pengajuan'});await send.focus();await student.page.keyboard.press('Enter')
  await expect(student.page.getByRole('heading',{name:'Pengajuan Terkirim'})).toBeVisible()
  await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
  const row=owner.page.getByTestId('owner-application').filter({hasText:'Mahasiswa keyboard'})
  const accept=row.getByRole('button',{name:'Terima'});await accept.focus();await owner.page.keyboard.press('Enter')
  const confirm=owner.page.getByRole('dialog').getByRole('button',{name:'Terima Pengajuan'});await confirm.focus();await owner.page.keyboard.press('Enter')
  await expect(row).toHaveCount(0)
 } finally {await owner.ctx.close();await student.ctx.close()}
})
