import {test,expect} from '@playwright/test';
import {mobileSignIn} from './mobile-session';
const roles:Record<string,string[]>={admin:['Transactions','Calls','Stock','Support','Workspace'],agent1:['Transactions','Stock','Support','Workspace'],leader:['Transactions','Stock','Support','Workspace'],compliance:['Transactions','Calls','Workspace'],inventory:['Stock','Support','Workspace'],salesmanager:['Transactions','Stock','Workspace'],tele:['Calls','Workspace'],welcome:['Calls','Workspace']};
for(const [account,categories] of Object.entries(roles)) {
 test(`web ${account} notification categories and links are authorized`,async({page,request})=>{
  const response=await request.post('/api/auth/login',{data:{email:`${account}@relay.demo`,password:process.env.DEMO_PASSWORD,native:true}});
  expect(response.status()).toBe(200);
  const headers={Authorization:`Bearer ${(await response.json()).access_token}`};
  const inbox=await(await request.get('/api/notifications',{headers})).json();
  expect(inbox.categories).toEqual(categories);
  await page.goto('/');
  await page.locator('input[type=email]').fill(`${account}@relay.demo`);
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await page.goto('/notifications');
  const filters=page.getByRole('group',{name:'Notification categories'});
  for(const category of ['Transactions','Calls','Stock','Support','Workspace']) {
   await expect(filters.getByRole('button',{name:new RegExp('^'+category)})).toHaveCount(categories.includes(category)?1:0);
  }
  const links=page.locator('.notification-open');
  if(inbox.items.length) {
   await expect(links.first()).toBeVisible();
   await links.first().click();
   await expect(page).not.toHaveURL(/notifications$/);
   await expect(page.getByRole('heading',{name:'This page is not available for your role'})).toHaveCount(0);
  }
  await page.goto('/notifications');
  await expect(filters.getByRole('button',{name:new RegExp('^'+categories[0])})).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await page.screenshot({path:`../output/qa/notification-access-${account}.png`});
 });
}
for(const account of ['leader','compliance','inventory','tele','welcome']) {
 test(`mobile ${account} notification categories are authorized`,async({page})=>{
  await mobileSignIn(page,`${account}@relay.demo`);
  await page.getByRole('button',{name:/Notifications/}).first().click();
  await expect(page.getByRole('switch',{name:'Unread only'})).toBeVisible({timeout:15000});
  for(const category of ['Transactions','Calls','Stock','Support','Workspace']) {
    await expect(page.getByRole('checkbox',{name:category,exact:true})).toHaveCount(roles[account].includes(category)?1:0);
  }
  await page.screenshot({path:`../output/qa/notification-mobile-access-${account}.png`});
 });
}

