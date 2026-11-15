import {test,expect} from './safe-fixtures'
import {outboxLink,ownIp} from '../tests/accounts'
import {writeFileSync} from 'node:fs'
test('B2 independent UI registration and return destination',async({page})=>{
 await ownIp(page);const email=`b2-recheck-${Date.now()}@example.com`
 await page.goto('/masuk');await page.getByRole('button',{name:'Daftar baru'}).click()
 await page.getByLabel('Nama Lengkap').fill('Penguji Audit')
 await page.getByLabel('Email').fill(email);await page.getByLabel('Kata Sandi').fill('Sandi-rahasia-123')
 await page.getByLabel(/Saya menyetujui/).check();await page.getByRole('button',{name:'Daftar Sekarang'}).click()
 await expect(page.getByText('Cek email Anda').first()).toBeVisible()
 await page.goto(await outboxLink(email,'verify-email'))
 await expect(page.getByRole('heading',{name:'Email berhasil diverifikasi'})).toBeVisible()
 await page.context().clearCookies();await page.goto('/masuk?next=%2Fprofile')
 await page.getByLabel('Email').fill(email);await page.getByLabel('Kata Sandi').fill('Sandi-rahasia-123')
 await page.getByRole('button',{name:'Masuk ke Akun'}).click()
 await page.waitForURL(u=>u.pathname!=='/masuk')
 const path=new URL(page.url()).pathname
 writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/B2-next-ui.json',JSON.stringify({expected:'/profile',observed:path}))
 expect(path).toBe('/profile')
})
