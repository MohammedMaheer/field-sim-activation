import {test, expect} from '@playwright/test';
import {mobileSignIn} from './mobile-session';

test('phone support form catches incomplete requests before submission', async ({page}) => {
  await mobileSignIn(page);
  await expect(page.getByText('Your day, at a glance', {exact:true})).toBeVisible({timeout:30000});
  const support = page.getByRole('button', {name:'Need field support?'});
  const host = await page.locator('#flutter-host').boundingBox();
  for (let i = 0; i < 15 && !(await support.count()); i++) {
    await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(120);
  }
  await support.click();
  await expect(page.getByText('Ask for field support')).toBeVisible();
  let submitted = false;
  page.on('request', request => {
    if (request.url().includes('/api/support-tickets') && request.method() === 'POST') submitted = true;
  });
  await page.getByRole('button', {name:'Send support request'}).click();
  await expect(page.getByText('Enter a subject of at least 3 characters').first()).toBeVisible();
  expect(submitted).toBe(false);
});
