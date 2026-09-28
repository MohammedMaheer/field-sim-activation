import {test, expect} from '@playwright/test';

test('phone preview exposes a readable capture action', async ({page}) => {
  await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/');
  await expect(page.getByText('Your day, at a glance', {exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('tab', {name:'Capture', exact:true}).click();
  await expect(page.getByRole('heading', {name:'New transaction'})).toBeVisible({timeout:10000});
  const upload = page.getByRole('button', {name:'Upload photo', exact:true});
  await expect(upload).toBeVisible();
  await expect(upload).toBeEnabled();
  const box = await upload.boundingBox();
  expect(box?.height).toBeLessThan(55);
  await expect(page.getByRole('button', {name:'Scan document', exact:true})).toBeEnabled();
  await page.screenshot({path:'../output/qa/mobile-upload-photo-36.png'});
});
