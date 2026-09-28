import { test, expect } from '@playwright/test';
import { authenticate } from './session';
test('primary receipt journey starts after external activation', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});
 await authenticate(page);
 await page.getByRole('link', {name:'Activation receipts',exact:true}).click();
 await expect(page).toHaveURL(/\/kyc-capture$/);
 await expect(page.getByRole('heading',{name:'Receipt verification'})).toBeVisible();
 await page.getByRole('button',{name:'New transaction capture',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Customer identity',exact:true})).toBeVisible();
 await expect(page.locator('.transaction-stages li')).toHaveText(['1Identity','2SIM & plan','3Receipt']);
 await expect(page.getByRole('button',{name:'Use synthetic sample'})).toHaveCount(0);
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`../output/qa/receipt-entry-${width}.png`,fullPage:true});
 }
});
