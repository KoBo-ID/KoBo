import {test,expect} from './safe-fixtures'
import {signUpVerified,outboxLink,ownIp} from '../tests/accounts'
test('B3 new password works and reset token cannot be reused',async({page,problems})=>{
 await ownIp(page);const email=await signUpVerified(page,'reset-reuse')
 await page.context().clearCookies();await page.goto('/masuk')
 await page.getByRole('button',{name:'Lupa kata sandi?'}).click();await page.getByLabel('Email').fill(email)
 await page.getByRole('button',{name:'Kirim Tautan Atur Ulang'}).click()
 await expect(page.getByText(/telah mengirim tautan untuk mengatur ulang/)).toBeVisible()
 const link=await outboxLink(email,'reset-password');await page.goto(link)
 const reset=async()=>{await page.getByLabel('Kata Sandi Baru',{exact:true}).fill('Sandi-baru-456');await page.getByLabel('Ulangi Kata Sandi Baru').fill('Sandi-baru-456');await page.getByRole('button',{name:'Simpan Kata Sandi Baru'}).click()}
 await reset();await expect(page.getByRole('heading',{name:'Kata sandi diperbarui'})).toBeVisible()
 const response=await page.context().request.post('/api/auth/sign-in/email',{data:{email,password:'Sandi-baru-456'},headers:{origin:'http://localhost:3100'}})
 expect(response.ok()).toBe(true)
 await page.goto(link)
 const invalid=page.getByRole('heading',{name:'Tautan tidak valid'})
 await expect(invalid.or(page.getByLabel('Kata Sandi Baru',{exact:true}))).toBeVisible({timeout:15000})
 if(!(await invalid.isVisible())) {await reset();await expect(page.getByRole('alert')).toBeVisible()}
 else await expect(invalid).toBeVisible()
 problems.splice(0,problems.length,...problems.filter(p=>!p.includes('400')))
})
