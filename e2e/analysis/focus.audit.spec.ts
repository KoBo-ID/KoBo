import {test,expect,type Page,type Locator} from './safe-fixtures'
import {newOwnerWorld,newStudent,apply} from '../tests/seams'
import {writeFileSync} from 'node:fs'
async function observe(page:Page,target:Locator,label:string,output:any[]){
 await expect(target).toBeVisible()
 const style=()=>target.evaluate(el=>{const s=getComputedStyle(el);return {outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:s.boxShadow,borderColor:s.borderColor,backgroundColor:s.backgroundColor,focusVisible:el.matches(':focus-visible')}})
 const before=await style()
 for(let i=0;i<100&&!await target.evaluate(el=>el===document.activeElement);i++) await page.keyboard.press('Tab')
 await expect(target).toBeFocused();const after=await style()
 await target.screenshot({path:`notes/analysis/2026-10-27-workflow/artifacts/focus-${label}.png`})
 output.push({label,before,after})
}
test('F2 focus presentation on priority controls',async({page,browser})=>{
 const out:any[]=[];await page.goto('/masuk');await observe(page,page.getByLabel('Email'),'login-email',out)
 const owner=await newOwnerWorld(browser,{label:'audit-focus-owner',rooms:1});const student=await newStudent(browser,{label:'audit-focus-student'})
 try {
  await student.page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
  await observe(student.page,student.page.getByLabel('Pekerjaan atau kegiatan utama'),'application-field',out)
  await apply(student,owner.rooms[0].id,{occupation:'Mahasiswa focus'})
  await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
  await observe(owner.page,owner.page.getByTestId('owner-application').filter({hasText:'Mahasiswa focus'}).getByRole('button',{name:'Terima'}),'owner-approve',out)
  writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/focus-styles.json',JSON.stringify(out,null,2))
 } finally {await owner.ctx.close();await student.ctx.close()}
})
