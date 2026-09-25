import { test, expect } from '@playwright/test';
import { authenticate } from './session';

test('live dashboard actions remain useful at desktop and phone widths', async ({ page }) => {
  await authenticate(page);
  await expect(page.getByRole('region', { name: 'Live field summary' })).toContainText('Today’s field performance');
  await page.getByRole('button', { name: 'View open field tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks & review queue' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: /KYC transaction capture/i })).toBeVisible();
});
