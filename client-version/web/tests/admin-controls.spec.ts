import {test,expect} from "@playwright/test";
import {authenticate} from "./session";

test("admin target change persists and restores with audit trail",async({page,request})=>{
 await authenticate(page);
 const auth=await request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
 expect(auth.ok()).toBeTruthy();
 const headers={Authorization:'Bearer '+(await auth.json()).access_token};
 const agents=await (await request.get('/api/resources/agents',{headers})).json();
 const a=agents.find((x:any)=>x.employee_id==='RLY-1041');
 try {
  await page.goto('/agents');await page.getByRole('button',{name:'View Zayn Mercer',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Manage',exact:true}).click();
  await expect(dialog.getByLabel('Daily target')).toHaveValue(String(a.target));
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`../output/qa/admin-management-${width}.png`,fullPage:false});}
  await page.setViewportSize({width:1440,height:1000});
  await dialog.getByLabel('Daily target').fill(String(a.target+1));
  await dialog.getByLabel('Reason for change').fill('Synthetic admin UI verification');
  await dialog.getByRole('button',{name:'Save agent changes'}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await (await request.get(`/api/agents/${a.id}/management`,{headers})).json();
  expect(saved.agent.target).toBe(a.target+1);
 } finally {
  const current=await (await request.get(`/api/agents/${a.id}/management`,{headers})).json();
  const c=current.agent;
  const restored=await request.patch(`/api/agents/${a.id}/management`,{headers,data:{target:a.target,outlet_id:a.outlet_id,leader_id:a.leader_id,expected_target:c.target,expected_outlet_id:c.outlet_id,expected_leader_id:c.leader_id,reason:'Restore synthetic test target'}});
  expect(restored.ok()).toBeTruthy();
 }
});

test("KYC history offers scoped search, review queue and recovery",async({page})=>{
 await authenticate(page);await page.goto('/kyc-capture');await page.getByRole('button',{name:'Capture history',exact:true}).click();
 await page.getByLabel('Search capture reference').fill('NO-SUCH-CAPTURE-987654321');
 await expect(page.getByText('No matching captures. Adjust the filters or return to the previous page.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Next captures',exact:true})).toBeDisabled();
 await page.getByLabel('Search capture reference').fill('');
 await page.getByRole('combobox',{name:'Verification status',exact:true}).selectOption('VERIFIED');
 await expect(page.locator('#capture-history .badge').first()).toHaveText('verified');
 await expect(page.getByRole('button',{name:'Previous captures',exact:true})).toBeDisabled();
});
