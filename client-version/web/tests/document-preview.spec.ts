import { test, expect } from '@playwright/test';
import {mobileSignIn} from './mobile-session';
for (const action of ['Scan details','Upload photo']) {
 test(`${action} reads customer screen and advances to order capture`, async ({page}) => {
  test.setTimeout(120000);
  await mobileSignIn(page);
  await page.getByRole('tab',{name:'Capture',exact:true}).click();
  await page.getByRole('button',{name:action,exact:true}).click();
  await expect(page.getByText(/Capturing document|Uploading photo/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Document captured View',exact:true})).toBeVisible({timeout:60000});
  await page.screenshot({path:`../output/qa/customer-order-${action.replaceAll(' ','-')}.png`});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Scan order',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Scan SIM barcode',exact:true})).toHaveCount(0);
  await page.screenshot({path:'../output/qa/order-capture.png'});
 });
}
