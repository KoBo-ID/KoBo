import {test,expect} from '@playwright/test'
import {loginAs} from '../tests/fixtures'
test('E1 owner paid receipt',async({page})=>{
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 await loginAs(page,'owner')
 await page.goto('/owner/dashboard?kos=kos-1')
 const row=page.getByRole('row').filter({hasText:'Dimas Pratama'})
 await expect(row).toHaveCount(1)
 await expect(row.getByText('Lunas',{exact:true})).toBeVisible()
 await row.getByRole('link',{name:/Lihat kuitansi Kamar/}).click()
 await expect(page.getByTestId('kuitansi-no')).toHaveText(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
 await page.reload()
 await expect(page.getByTestId('kuitansi-no')).toHaveText(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
})
