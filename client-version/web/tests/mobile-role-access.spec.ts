import {test,expect} from '@playwright/test';
import {mobileSignIn} from './mobile-session';
for (const account of ['agent1','leader','inventory','compliance','salesmanager','tele','welcome']) {
  test(`mobile ${account} blocks forbidden deep links`,async({page})=>{
    test.setTimeout(120000);
    await mobileSignIn(page,`${account}@relay.demo`);
    const base=process.env.MOBILE_PREVIEW_URL!;
    const denied=account==='agent1'?'/call-work':'/ekyc';
    await page.goto(base+'#'+denied);
    await expect(page.getByRole('textbox',{name:'Work email'})).toBeHidden({timeout:30000});
    await expect.poll(()=>page.url(),{timeout:30000}).not.toContain('#'+denied);
    await expect(page.getByRole('heading',{name:'New transaction',exact:true})).toHaveCount(0);
    await page.waitForTimeout(1200);
    await page.screenshot({path:`../output/qa/access-mobile-${account}.png`});
  });
}
