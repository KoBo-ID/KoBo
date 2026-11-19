import {test,expect} from './safe-fixtures'
import {outboxCode,ownIp} from '../tests/accounts'
import {writeFileSync} from 'node:fs'
test('B2 independent UI registration and return destination',async({page})=>{
 await ownIp(page);const email=`b2-recheck-${Date.now()}@example.com`
 await page.goto('/masuk');await page.getByRole('button',{name:'Daftar baru'}).click()
 await page.getByLabel('Nama Lengkap').fill('Penguji Audit')
 await page.getByLabel('Email').fill(email);await page.getByLabel('Kata Sandi', { exact: true }).fill('Sandi-rahasia-123')
 await page.getByLabel(/Saya menyetujui/).check();await page.getByRole('button',{name:'Daftar Sekarang'}).click()
 await expect(page.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}`)).toBeVisible()
 await page.getByLabel('Kode verifikasi').fill(await outboxCode(email,'verify-email'))
 await page.getByRole('button',{name:'Verifikasi',exact:true}).click()
 await expect(page).toHaveURL(/\/$/)
 await page.context().clearCookies();await page.goto('/masuk?next=%2Fprofile')
 await page.getByLabel('Email').fill(email);await page.getByLabel('Kata Sandi', { exact: true }).fill('Sandi-rahasia-123')
 await page.getByRole('button',{name:'Masuk ke Akun'}).click()
 await page.waitForURL(u=>u.pathname!=='/masuk')
 const path=new URL(page.url()).pathname
 writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/B2-next-ui.json',JSON.stringify({expected:'/profile',observed:path}))
 expect(path).toBe('/profile')
})
