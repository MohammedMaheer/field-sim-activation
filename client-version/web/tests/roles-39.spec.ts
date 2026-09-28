import {test, expect} from '@playwright/test';
for (const [account, role] of [['admin','Administrator'],['agent1','Field Agent'],['compliance','Compliance Officer']]) {
 test(`${role} sees appropriate workspace`, async ({page}) => {
  await page.goto('/');
  await page.locator('input[type=email]').fill(`${account}@relay.demo`);
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  const nav = page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link',{name:'Manage workspace',exact:true})).toHaveCount(account === 'admin' ? 1 : 0);
  await expect(nav.getByRole('link',{name:'Audit log',exact:true})).toHaveCount(account === 'agent1' ? 0 : 1);
  await expect(nav.getByRole('link',{name:'New transaction',exact:true})).toHaveCount(account === 'agent1' ? 1 : 0);
  if(account !== 'admin') {
   await page.goto('/administration');
   await expect(page.getByRole('heading',{name:'This page is not available for your role'})).toBeVisible();
  }
  await page.screenshot({path:`../output/qa/role-39-${account}.png`});
 });
}
