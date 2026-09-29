import {test, expect} from '@playwright/test';
test('camera recovery is readable and retries without a scanning overlay', async ({page}) => {
  await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/');
  await expect(page.getByText('Your day, at a glance', {exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('tab', {name:'Capture',exact:true}).click();
  await page.getByText('Passport', {exact:true}).click();
  await expect(page.getByRole('group', {name:'Camera unavailable Enable camera or upload photo', exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await expect(page.getByText('Position passport', {exact:true})).toHaveCount(0);
  await page.screenshot({path:'../output/qa/scanner40-passport-recovery.png'});
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('group', {name:'Camera unavailable Enable camera or upload photo', exact:true})).toBeVisible();
  await page.getByText('Emirates ID', {exact:true}).click();
  await expect(page.getByRole('button',{name:'Upload photo',exact:true})).toBeVisible();
  await page.screenshot({path:'../output/qa/scanner40-id-recovery.png'});
});
