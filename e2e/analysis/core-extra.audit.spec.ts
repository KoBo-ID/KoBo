import {test,expect,loginAs} from './safe-fixtures'
import {signUpVerified,ownIp} from '../tests/accounts'
test('B2 verified sign in returns to next and persists',async({page})=>{
 await ownIp(page)
 const email=await signUpVerified(page,'next-user')
 await page.context().clearCookies()
 await page.goto('/masuk?next=%2Fprofile')
 await page.getByLabel('Email').fill(email)
 await page.getByLabel('Kata Sandi').fill('Sandi-rahasia-123')
 await page.getByRole('button',{name:'Masuk ke Akun'}).click()
 await expect(page).toHaveURL(/\/profile$/)
 await page.reload()
 await expect(page).toHaveURL(/\/profile$/)
 await expect(page.getByRole('heading',{name:/Profil/}).first()).toBeVisible()
})
test('E1 demo search discovers the previously used kos',async({page})=>{
 await loginAs(page,'student')
 await page.goto('/search')
 const link=page.locator('a[href="/kos/kos-1"]').first()
 await expect(link).toBeVisible()
 await link.click()
 await expect(page).toHaveURL(/\/kos\/kos-1$/)
 await expect(page.getByRole('heading',{level:1})).toBeVisible()
})
