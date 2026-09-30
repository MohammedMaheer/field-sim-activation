import {test,expect,Page} from '@playwright/test';
import {mobileSignIn} from './mobile-session';

async function signIn(page:Page, account:string){
  await page.goto('/');
  await page.locator('input[type=email]').fill(`${account}@relay.demo`);
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.locator('input[type=email]')).toBeHidden();
}

test('dedicated call staff have a scoped, responsive queue',async({page})=>{
  await signIn(page,'tele');
  await expect(page.getByRole('heading',{name:'Call work queue'})).toBeVisible();
  await expect(page.getByRole('link',{name:'SIM inventory',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Ready to contact'})).toBeVisible();
  await page.screenshot({path:'../output/qa/call-queue-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.sidebar')!.getBoundingClientRect().right<=1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'../output/qa/call-queue-phone.png',fullPage:true,animations:'disabled'});
});

test('Sales Manager sees branch reports without stock or sale write controls',async({page})=>{
  await signIn(page,'salesmanager');
  await page.goto('/sales');
  await expect(page.getByRole('heading',{name:'Sales management'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Record sale'})).toHaveCount(0);
  await page.goto('/equipment');
  await expect(page.getByRole('heading',{name:'Assets & supplies'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add asset'})).toHaveCount(0);
  await page.getByRole('button',{name:'Balances & alerts',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Balances & shortage alerts'})).toBeVisible();
});

test('stock reports and return checklist stay usable',async({page})=>{
  await signIn(page,'admin');
  await page.goto('/equipment');
  await page.getByRole('button',{name:'Balances & alerts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Set alert level'})).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await page.screenshot({path:'../output/qa/stock-balances-desktop.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Movements',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Stock movements'})).toBeVisible();
  await page.getByRole('button',{name:'Returns & transfers',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Stock return checklist',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Stock return checklist',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Agent',exact:true}).last().selectOption({label:'Zayn Mercer'});
  await expect(page.getByText(/^Return, transfer or write off outstanding stock/)).toBeVisible();
  await page.screenshot({path:'../output/qa/stock-checklist-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.sidebar')!.getBoundingClientRect().right<=1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('call-team phone demo signs in to the same queue',async({page})=>{
  test.skip(!process.env.MOBILE_PREVIEW_URL,'Phone preview URL required');
  test.setTimeout(120000);
  const layoutErrors:string[]=[];
  page.on('console',message=>{if (/RenderBox was not laid out|BoxConstraints forces an infinite|RenderFlex overflowed/i.test(message.text())) layoutErrors.push(message.text());});
  await mobileSignIn(page,'tele@relay.demo');
  await expect(page.getByText('Call work queue',{exact:true}).first()).toBeVisible({timeout:30000});
  await expect(page.getByText(/^Ready to contact/)).toBeVisible();
  if (process.env.RELAY_OPERATIONS_MUTATION_TEST) {
    await expect(page.getByRole('button',{name:'Record call'}).first()).toBeVisible();
    await page.screenshot({path:'../output/qa/mobile-call-queue.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Record call'}).first().click();
    await expect(page.getByRole('button',{name:'Save outcome'})).toBeVisible();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save outcome'})).toHaveCount(0);
  } else {
    await expect(page.getByRole('button',{name:'Record call'}).first().or(page.getByText('No calls in this view'))).toBeVisible();
  }
  if (!process.env.RELAY_OPERATIONS_MUTATION_TEST) await page.screenshot({path:'../output/qa/mobile-call-queue.png',fullPage:true,animations:'disabled'});
  expect(layoutErrors).toEqual([]);
});

test('tele-verification releases a welcome call across signed-in users',async({browser,request,baseURL})=>{
  test.skip(!process.env.RELAY_OPERATIONS_MUTATION_TEST,'Run only against the isolated test dataset');
  const auth=await request.post(`${baseURL}/api/auth/login`,{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  expect(auth.ok()).toBeTruthy();
  const token=(await auth.json()).access_token;
  const headers={Authorization:`Bearer ${token}`};
  const agents=await (await request.get(`${baseURL}/api/resources/agents`,{headers})).json();
  const agent=agents.find((row:any)=>row.employee_id==='RLY-1041');
  const reference=`QUEUE-CHECK-${Date.now()}`;
  const sale=await request.post(`${baseURL}/api/sales-management/sales`,{headers,data:{agent_id:agent.id,order_type:'NEW',customer_name:reference,request_id:reference,plan_name:'5G Unlimited Ultra',msisdn:'Not recorded'}});
  expect(sale.status()).toBe(201);
  const teleContext=await browser.newContext();const welcomeContext=await browser.newContext();
  const tele=await teleContext.newPage();const welcome=await welcomeContext.newPage();
  await signIn(welcome,'welcome');
  await welcome.getByRole('button',{name:'Waiting',exact:true}).click();
  await expect(welcome.locator('.call-task').filter({hasText:reference})).toBeVisible();
  await signIn(tele,'tele');
  const card=tele.locator('.call-task').filter({hasText:reference});
  await card.getByRole('button',{name:'Record call'}).click();
  await tele.getByRole('combobox',{name:'Outcome',exact:true}).selectOption('PASSED');
  await tele.getByLabel('Call remark').fill('Confirmed customer details from submitted evidence');
  await tele.getByRole('button',{name:'Save outcome'}).click();
  await expect(tele.getByRole('status').filter({hasText:'Call outcome recorded'})).toBeVisible();
  await welcome.getByRole('button',{name:'Refresh',exact:true}).click();
  await welcome.getByRole('button',{name:'Ready',exact:true}).click();
  await welcome.locator('.call-task').filter({hasText:reference}).getByRole('button',{name:'Record call'}).click();
  await welcome.getByRole('combobox',{name:'Outcome',exact:true}).selectOption('REACHED');
  await welcome.getByLabel('Call remark').fill('Customer welcomed after verification');
  await welcome.getByRole('button',{name:'Save outcome'}).click();
  await expect(welcome.getByRole('status').filter({hasText:'Call outcome recorded'})).toBeVisible();
  await welcome.getByRole('button',{name:'Completed',exact:true}).click();
  await expect(welcome.locator('.call-task').filter({hasText:reference})).toBeVisible();
  await teleContext.close();await welcomeContext.close();
});
