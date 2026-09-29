import {test,expect} from '@playwright/test';

async function signIn(page:any,email:string) {
  await page.goto('/');
  await page.getByRole('textbox',{name:'Work email'}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button',{name:/Sign in/}).click();
  await expect(page.locator('.sidebar')).toBeVisible({timeout:20000});
}

test('administrator pages show compact summaries and branch leadership',async({page}) => {
  test.setTimeout(120000);
  await signIn(page,'admin@relay.demo');
  for(const path of ['team-leaders','agents','branches','customers','activations','inventory','incentives','support','audit','plans','administration','kyc-capture']) {
    await page.goto('/'+path);
    await expect(page.locator('.record-overview')).toBeVisible({timeout:20000});
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.waitForTimeout(600);
    await page.screenshot({path:`../output/qa/overview-${path}.png`,fullPage:true});
    if(path === 'team-leaders') {
      await expect(page.getByRole('button',{name:'Manage team leaders'})).toBeVisible();
      await page.getByRole('button',{name:'Manage team leaders'}).click();
      await expect(page.getByRole('button',{name:'Team leader',exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(page.getByRole('textbox',{name:'Team leader name'})).toBeVisible();
      await page.waitForTimeout(600);
    await page.screenshot({path:'../output/qa/team-leader-setup.png'});
    }
  }
});

test('team leader sees backend-confirmed records with no approval action',async({page}) => {
  await signIn(page,'leader2@relay.demo');
  await page.goto('/team-leaders');
  await expect(page.getByRole('heading',{name:'Backend confirmations'})).toBeVisible();
  await expect(page.getByRole('button',{name:'View details'}).first()).toBeVisible({timeout:20000});
  await expect(page.getByRole('button',{name:/Confirm branch|Manage team leaders|Verify submission/})).toHaveCount(0);
  await page.getByRole('button',{name:'View details'}).first().click();
  await expect(page.getByText('Transaction confirmed by backend',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Verify submission',exact:true})).toHaveCount(0);
  await page.screenshot({path:'../output/qa/team-leader-read-only-record.png',fullPage:true});
});
