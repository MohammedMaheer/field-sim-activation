import {test,expect} from '@playwright/test';
import {mobileSignIn} from './mobile-session';

async function signIn(page:any, account='admin') {
  await page.goto('/');
  await page.locator('input[type=email]').fill(`${account}@relay.demo`);
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.locator('input[type=password]')).toBeHidden();
}

test('sale detail retains every required field and fits desktop and narrow screen',async({page})=>{
  await signIn(page);
  await page.goto('/sales');
  await page.locator('.sale-detail-link').first().click();
  const detail=page.locator('.sale-detail-grid');
  await expect(detail).toBeVisible();
  for(const field of ['Employee ID','Team leader','Sales Manager','Assignment effective','Order type','Account number','SIM serial','Router serial','SR number','Alternate number']) await expect(detail.getByText(field,{exact:true})).toBeVisible();
  await page.screenshot({path:'../output/qa/modern-trade-sale-detail.png'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'../output/qa/modern-trade-sale-detail-phone.png'});
});

test('backend staff can manage staff and branches without permanent deletion controls',async({page})=>{
  await signIn(page,'ops');
  await page.getByRole('link',{name:'Manage workspace',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Manage workspace',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Delete /})).toHaveCount(0);
  await page.goto('/sales');
  await page.getByRole('button',{name:'Sales staff',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sales and call staff',exact:true})).toBeVisible();
});

test('target upload previews applies and reaches the signed-in agent phone',async({page,browser})=>{
  test.skip(!process.env.RELAY_RIGOROUS_MUTATION_TEST,'Only mutate isolated PostgreSQL data');
  test.setTimeout(120000);
  await signIn(page);
  await page.goto('/sales');
  await page.getByRole('button',{name:'Targets',exact:true}).click();
  const period=new Date().toISOString().slice(0,7);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download target file',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/sales-targets.*xlsx/);
  const auth=await page.request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  const headers={Authorization:`Bearer ${(await auth.json()).access_token}`};
  const existing=await page.request.get(`/api/sales-management/targets?period=${period}`,{headers});
  const records=await existing.json();
  const agents=await (await page.request.get('/api/resources/agents',{headers})).json();
  const agent=agents.find((a:any)=>a.employee_id==='RLY-1041');
  const target=records.find((r:any)=>r.agent_id===agent.id&&r.order_type==='ALL');
  const monthly=(target?.monthly_target||0)+17;
  const csv=`employee_id,period,order_type,current_daily,current_monthly,daily_target,monthly_target\n${agent.employee_id},${period},ALL,${target?.daily_target??''},${target?.monthly_target??''},4,${monthly}`;
  await page.getByLabel('Target file',{exact:true}).setInputFiles({name:'approved-targets.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('button',{name:'Preview targets',exact:true}).click();
  await expect(page.getByText('1 targets · 0 errors',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Apply 1 targets',exact:true}).click();
  await expect(page.getByText('1 targets · 0 errors · Applied',{exact:true})).toBeVisible();
  const phoneContext=await browser.newContext();const phone=await phoneContext.newPage();
  await mobileSignIn(phone);
  await phone.goto(process.env.MOBILE_PREVIEW_URL+'#/sales-management');
  await phone.getByText('Targets',{exact:true}).click();
  await expect(phone.getByText(new RegExp(`${monthly} / month`))).toBeVisible({timeout:30000});
  await phone.screenshot({path:'../output/qa/modern-trade-mobile-targets.png'});
  await phoneContext.close();
});

test('phone sign-out leaves no nested private screen visible',async({page})=>{
  await mobileSignIn(page);
  await page.goto(process.env.MOBILE_PREVIEW_URL+'#/sales-management');
  await expect(page.getByText('Sales management',{exact:true}).first()).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Work email'})).toBeVisible({timeout:30000});
  await expect(page.getByText('Sales management',{exact:true})).toBeHidden();
  await page.screenshot({path:'../output/qa/modern-trade-mobile-signed-out.png'});
});
