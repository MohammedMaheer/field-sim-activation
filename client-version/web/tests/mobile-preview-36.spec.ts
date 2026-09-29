import {mobileSignIn} from './mobile-session';
import {test, expect} from '@playwright/test';

test('phone preview exposes a readable capture action', async ({page}) => {
  await mobileSignIn(page);
  await expect(page.getByText('Your day, at a glance', {exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('tab', {name:'Capture', exact:true}).click();
  await expect(page.getByRole('heading', {name:'New transaction'})).toBeVisible({timeout:10000});
  await expect(page.getByRole('textbox', {name:'Full name', exact:true})).toBeVisible();
  await expect(page.getByRole('textbox', {name:'Document number', exact:true})).toBeVisible();
  const upload = page.getByRole('button', {name:'Upload photo', exact:true});
  await expect(upload).toBeVisible();
  await expect(upload).toBeEnabled();
  const box = await upload.boundingBox();
  expect(box?.height).toBeLessThan(55);
  await expect(page.getByRole('button', {name:'Scan details', exact:true})).toBeEnabled();
  await page.screenshot({path:'../output/qa/mobile-upload-photo-36.png'});
});
