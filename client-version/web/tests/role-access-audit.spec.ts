import {test,expect} from '@playwright/test';

for (const account of ['admin','ops','leader','leader2','cluster','agent1','compliance','inventory','salesmanager','tele','welcome']) {
  test(`${account}: server permissions and direct navigation agree`, async ({page,request}) => {
    const login = await request.post('/api/auth/login',{data:{email:`${account}@relay.demo`,password:process.env.DEMO_PASSWORD,native:true}});
    expect(login.status()).toBe(200);
    const session = await login.json();
    const headers = {Authorization:`Bearer ${session.access_token}`};
    const writer = ['admin','ops','agent1'].includes(account);
    expect(session.user.permissions.includes('ekyc.write')).toBe(writer);
    if (!writer) {
      expect((await request.put('/api/kyc-captures/draft',{headers,data:{version:0,data:{}}})).status()).toBe(403);
      expect((await request.post('/api/kyc-captures/missing/submit',{headers,data:{version:1}})).status()).toBe(403);
    }
    await page.goto('/');
    await page.locator('input[type=email]').fill(`${account}@relay.demo`);
    await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button',{name:'Sign in to workspace'}).click();
    await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
    await page.goto('/kyc-capture');
    if (['tele','welcome'].includes(account)) {
      await expect(page).toHaveURL(/call-work/);
    } else if (['inventory','salesmanager'].includes(account)) {
      await expect(page.getByRole('heading',{name:'This page is not available for your role'})).toBeVisible();
    } else {
      await expect(page.getByRole('button',{name:'Capture history',exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'New transaction capture',exact:true})).toHaveCount(writer ? 1 : 0);
      if (['leader','leader2','cluster'].includes(account)) {
        await expect(page.getByRole('heading',{name:'Transaction history',exact:true}).first()).toBeVisible();
      }
    }
    await page.waitForTimeout(1000);
    await page.screenshot({path:`../output/qa/access-${account}.png`,fullPage:true});
    await page.goto('/administration');
    if (!['admin','ops','tele','welcome'].includes(account)) {
      await expect(page.getByRole('heading',{name:'This page is not available for your role'})).toBeVisible();
    }
  });
}
