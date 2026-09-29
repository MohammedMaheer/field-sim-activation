import {test,expect} from '@playwright/test';
import {mobileSignIn} from './mobile-session';

test('phone demo opens shared sales and asset screens',async({page})=>{
  test.setTimeout(120000);
  await mobileSignIn(page);
  const preview = process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5188/mobile-demo/';
  await page.goto(new URL('#/sales-management', preview).toString());
  await expect(page.getByText('Sales management',{exact:true}).first()).toBeVisible({timeout:30000});
  await page.screenshot({path:'../output/qa/mobile-sales-management.png',fullPage:true});
  await page.goto(new URL('#/assets', preview).toString());
  await expect(page.getByText('Assets & supplies',{exact:true}).first()).toBeVisible({timeout:30000});
  await expect(page.getByText('Branch assets',{exact:true})).toBeVisible({timeout:30000});
  await page.waitForTimeout(350);
  await page.screenshot({path:'../output/qa/mobile-field-assets.png',fullPage:true});
});
