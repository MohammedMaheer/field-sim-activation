import {test, expect} from '@playwright/test';

test('phone invoice feeds down and supporting records stay collapsed', async ({page}) => {
  await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/');
  await expect(page.getByText('Your day, at a glance', {exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('tab', {name:'Capture',exact:true}).click();
  await page.getByRole('button', {name:'History',exact:true}).click();
  await page.getByText(/^PAY-/).first().click();
  const replay = page.getByRole('button', {name:'Replay invoice printing',exact:true});
  await expect(replay).toBeVisible();
  await page.waitForTimeout(2400);
  await page.screenshot({path:'../output/qa/invoice-39-phone-complete.png'});
  await replay.click();
  await page.waitForTimeout(350);
  await page.screenshot({path:'../output/qa/invoice-39-phone-printing.png'});
  await page.waitForTimeout(2300);
  await expect(page.getByRole('group', {name:/Payment successful Pending verification/}).first()).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Field name',exact:true})).toHaveCount(0);
  await expect(page.getByText('YOUR TRANSACTION · STEP 3 OF 3')).toHaveCount(0);
});

