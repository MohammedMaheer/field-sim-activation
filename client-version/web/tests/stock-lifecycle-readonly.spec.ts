import {test,expect} from '@playwright/test';
import {authenticate} from './session';

test('published category editor and branch departure checklist are available',async({page,request})=>{
  await authenticate(page);
  const login=await request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  expect(login.ok()).toBeTruthy();
  const headers={Authorization:'Bearer '+(await login.json()).access_token};
  const stock=await (await request.get('/api/resources/inventory',{headers})).json();
  expect(stock.every((s:any)=>typeof s.business_category==='string')).toBeTruthy();
  const sim=stock.find((s:any)=>s.status==='AVAILABLE'&&!s.scan_transaction_id);
  await page.goto('/inventory?selected='+sim.id);
  await expect(page.getByRole('combobox',{name:'Business category',exact:true})).toBeVisible();
  const iccid=await page.getByRole('textbox',{name:'ICCID',exact:true}).boundingBox();
  const serial=await page.getByRole('textbox',{name:'SIM serial',exact:true}).boundingBox();
  expect(Math.abs(iccid!.y-serial!.y)).toBeLessThan(2);
  await page.screenshot({path:'../output/qa/published-stock-category.png'});
  const branches=await(await request.get('/api/resources/branches',{headers})).json();
  expect(branches.every((b:any)=>typeof b.lifecycle_status==='string')).toBeTruthy();
  await page.goto('/equipment?tab=checklist&branch='+branches[0].id);
  await expect(page.getByRole('heading',{name:'Branch departure'})).toBeVisible();
  await page.screenshot({path:'../output/qa/published-branch-checklist.png'});
});
