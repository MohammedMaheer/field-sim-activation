import { test, expect } from '@playwright/test';
import { authenticate } from './session';

test('SIM details can be edited and restored through the admin panel', async ({ page }) => {
  await authenticate(page);
  await page.goto('/inventory');
  await page.getByRole('combobox', {name: 'Filter status'}).selectOption('AVAILABLE');
  const row = page.locator('tbody tr').first();
  await row.locator('.record-link').click();
  await expect(page.getByRole('heading', { name: 'Edit SIM details' })).toBeVisible();
  const serial = page.getByLabel('SIM serial', { exact: true });
  const original = await serial.inputValue();
  await serial.fill(`${original}-QA`);
  await page.getByLabel('Reason for edit').fill('Corrected serial against stock label');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await serial.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `../output/qa/inventory-edit-${width}.png` });
  }
  await page.getByRole('button', { name: 'Save SIM details' }).click();
  await expect(page.locator('.toast')).toContainText('SIM details updated');
  await row.locator('.record-link').click();
  await expect(serial).toHaveValue(`${original}-QA`);
  await serial.fill(original);
  await page.getByLabel('Reason for edit').fill('Restored original synthetic serial');
  await page.getByRole('button', { name: 'Save SIM details' }).click();
  await expect(page.locator('.toast')).toContainText('SIM details updated');
});
