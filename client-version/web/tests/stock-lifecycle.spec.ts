import {test,expect} from '@playwright/test';
import {authenticate} from './session';
import {mobileSignIn} from './mobile-session';

test('SIM business category is editable and remains visible in inventory', async ({page})=>{
  test.skip(process.env.RELAY_RIGOROUS_MUTATION_TEST!=="1", "Isolated QA only");
  await authenticate(page);
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  expect(login.ok()).toBeTruthy();
  const headers={Authorization:'Bearer '+(await login.json()).access_token};
  const records=await (await page.request.get('/api/resources/inventory',{headers})).json();
  const sim=records.find((row:any)=>row.status==='AVAILABLE'&&!row.scan_transaction_id);
  expect(sim).toBeTruthy();
  await page.goto('/inventory?selected='+sim.id);
  const category=page.getByRole('combobox',{name:'Business category',exact:true});
  const original=await category.inputValue();
  await category.selectOption('Visitor');
  await page.getByLabel('Reason for edit').fill('Classify synthetic stock for category check');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    if(width===390) await expect(page.locator(".sidebar")).not.toBeInViewport();
    await category.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`../output/qa/stock-category-${width}.png`});
  }
  await page.getByRole('button',{name:'Save SIM details'}).click();
  await expect(page.locator('.toast')).toContainText('SIM details updated');
  await page.goto('/inventory?selected='+sim.id);
  await expect(category).toHaveValue('Visitor');
  await category.selectOption(original);
  await page.getByLabel('Reason for edit').fill('Restore original synthetic category');
  await page.getByRole('button',{name:'Save SIM details'}).click();
});

test('branch lifecycle has a clear accounting checklist and completion',async({page})=>{
  test.skip(process.env.RELAY_RIGOROUS_MUTATION_TEST!=="1", "Isolated QA only");
  await authenticate(page);
  const login=await page.request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  expect(login.ok()).toBeTruthy();
  const headers={Authorization:'Bearer '+(await login.json()).access_token};
  const result=await page.request.post('/api/organization/branches',{headers,data:{name:`Lifecycle visual ${Date.now()}`}});
  expect(result.status()).toBe(201);
  const branch=await result.json();
  await page.goto(`/equipment?tab=checklist&branch=${branch.id}`);
  await expect(page.getByRole('heading',{name:'Branch departure'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Or branch',exact:true})).toHaveValue(branch.id);
  await expect(page.locator('.skeleton').first()).toHaveCount(0);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    if(width===390) await expect(page.locator(".sidebar")).not.toBeInViewport();
    await page.getByRole('heading',{name:'Branch departure'}).scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`../output/qa/branch-lifecycle-${width}.png`});
  }
  await page.getByRole('combobox',{name:'Operation',exact:true}).selectOption('START_CLOSURE');
  await page.locator('.branch-lifecycle input[name="reason"]').fill('Close unused synthetic branch');
  await page.getByRole('button',{name:'Update branch',exact:true}).click();
  await expect(page.locator('.branch-lifecycle .status')).toHaveText('CLOSING');
  await page.getByRole('combobox',{name:'Operation',exact:true}).selectOption('COMPLETE');
  await page.locator('.branch-lifecycle input[name="reason"]').fill('No outstanding stock or records');
  await page.getByRole('button',{name:'Update branch',exact:true}).click();
  await expect(page.locator('.branch-lifecycle .status')).toHaveText('CLOSED');
  await expect(page.getByRole('button',{name:'Update branch',exact:true})).toHaveCount(0);
});


test('admin category updates reach the signed-in phone inventory',async({page,request})=>{
  test.skip(process.env.RELAY_RIGOROUS_MUTATION_TEST!=="1", "Isolated QA only");
  test.setTimeout(90000);
  const admin=await request.post('/api/auth/login',{data:{email:'admin@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  const adminHeaders={Authorization:'Bearer '+(await admin.json()).access_token};
  const agent=await request.post('/api/auth/login',{data:{email:'agent1@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  const agentHeaders={Authorization:'Bearer '+(await agent.json()).access_token};
  const assignment=(await (await request.get('/api/resources/agents',{headers:agentHeaders})).json())[0];
  const created=await request.post('/api/administration/inventory',{headers:adminHeaders,data:{values:{iccid:'QA-CATEGORY-'+Date.now(),serial:'QA-CATEGORY-SERIAL-'+Date.now(),sim_type:'Physical',business_category:'Postpaid',outlet_id:assignment.outlet_id,agent_id:assignment.id},reason:'Synthetic stock for shared visibility check'}});
  expect(created.ok(),await created.text()).toBeTruthy();
  const sim=await created.json();
  const body={iccid:sim.iccid,serial:sim.serial,sim_type:sim.sim_type,expected_iccid:sim.iccid,expected_serial:sim.serial,expected_type:sim.sim_type,
    business_category:'Visitor',expected_category:sim.business_category,reason:'Check shared phone category visibility'};
  const changed=await request.patch('/api/inventory/'+sim.id,{headers:adminHeaders,data:body});
  expect(changed.ok(),await changed.text()).toBeTruthy();
  try{
    await mobileSignIn(page);
    await page.getByRole('tab',{name:'Stock',exact:true}).click();
    await expect(page.getByText(sim.sim_type+' · Visitor',{exact:false}).first()).toBeVisible({timeout:30000});
    await page.screenshot({path:'../output/qa/phone-demo-stock-category.png'});
  }finally{
    const restored=await request.patch('/api/inventory/'+sim.id,{headers:adminHeaders,data:{...body,business_category:sim.business_category,expected_category:'Visitor',reason:'Restore original synthetic category'}});
    expect(restored.ok(),await restored.text()).toBeTruthy();
    const retired=await request.post('/api/inventory/'+sim.id+'/move',{headers:adminHeaders,data:{status:'RETIRED',reason:'Synthetic visibility check complete'}});
    expect(retired.ok(),await retired.text()).toBeTruthy();
  }
});
