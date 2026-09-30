import { test, expect } from '@playwright/test';
import { authenticate } from './session';

test('live dashboard actions remain useful at desktop and phone widths', async ({ page }) => {
  await authenticate(page);
  await expect(page.getByRole('region', { name: 'Live field summary' })).toContainText('Today’s field performance');
  await expect(page.getByRole('heading', { name: 'Branch snapshot' })).toHaveCount(0);
  for (const [name, route, heading] of [
    ['Sales in progress', '/sales', 'Sales management'],
    ['Calls ready', '/call-work', 'Call work queue'],
    ['Stock requests', '/equipment', 'Assets & supplies'],
    ['Open support', '/support', 'Support & help'],
  ]) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(route + (route === '/equipment' ? '\\?tab=requests$' : '$')));
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (route === '/equipment') await expect(page.getByRole('heading',{name:'Asset requests',exact:true})).toBeVisible();
    await page.goto('/');
  }
  await page.getByRole('button', { name: 'Open backend verification' }).click();
  await expect(page.getByRole('heading', { name: 'Backend verification', exact:true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'View recorded incentives' }).click();
  await expect(page.getByRole('heading', { name: /Incentives/i })).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Capture transaction' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: '../output/qa/colour-dashboard-' + width + '.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Capture transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Backend verification', exact:true })).toBeVisible();
});
