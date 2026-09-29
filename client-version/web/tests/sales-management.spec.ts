import { test, expect } from '@playwright/test';

test('sales workspace records feedback and fits desktop and phone', async ({page}) => {
  await page.goto('/');
  await page.locator('input[type=email]').fill('admin@relay.demo');
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD || 'RelayDemo!2026');
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.getByRole('heading',{name:'Operations overview'})).toBeVisible();
  await page.goto('/sales');
  await expect(page.getByRole('heading',{name:'Sales management'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sales register'})).toBeVisible();
  await page.getByRole('button',{name:'Correct'}).first().click();
  await expect(page.getByLabel('Reason for correction')).toBeVisible();
  await page.getByRole('button',{name:'Cancel'}).click();
  await page.getByRole('button',{name:'Record sale'}).click();
  await expect(page.getByLabel('Order type')).toBeVisible();
  await page.getByRole('button',{name:'No-sale feedback'}).click();
  await page.getByRole('button',{name:'Add feedback'}).click();
  await expect(page.getByLabel('Rejection reason')).toBeVisible();
  await page.screenshot({path:'../output/qa/sales-management-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(350);
  await expect(page.getByRole('heading',{name:'Sales management'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({path:'../output/qa/sales-management-phone.png',fullPage:true});
});

test('field asset register and requests are available without layout overflow', async ({page}) => {
  await page.goto('/');
  await page.locator('input[type=email]').fill('admin@relay.demo');
  await page.locator('input[type=password]').fill(process.env.DEMO_PASSWORD || 'RelayDemo!2026');
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
  await expect(page.getByRole('heading',{name:'Operations overview'})).toBeVisible();
  await page.goto('/equipment');
  await expect(page.getByRole('heading',{name:'Assets & supplies'})).toBeVisible();
  await page.getByRole('button',{name:'Add asset'}).click();
  await expect(page.getByLabel('Serial (if applicable)')).toBeVisible();
  await page.getByRole('button',{name:/^Requests/}).click();
  await expect(page.getByRole('heading',{name:'Asset requests'})).toBeVisible();
  await expect(page.locator('.sales-section .sales-table tbody tr').first()).toBeVisible();
  await page.screenshot({path:'../output/qa/field-assets-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({path:'../output/qa/field-assets-phone.png',fullPage:true});
});
