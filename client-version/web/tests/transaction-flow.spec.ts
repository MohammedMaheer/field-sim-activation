import { test, expect } from '@playwright/test';
import { authenticate } from './session';

for (const kind of ['National ID', 'Passport']) {
  test(`ZIP flow: ${kind}, VPS OCR, allocation, synchronized demo receipt`, async ({ page }) => {
    test.setTimeout(120000);
    await authenticate(page);
    await page.goto('/kyc-capture');
    await expect(page.getByRole('heading', { name: 'Verify the customer' })).toBeVisible();
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page.getByRole('button', { name: 'Use synthetic sample' }).click();
    await expect(page.getByLabel('Full legal name')).toHaveValue('Jordan Demo', { timeout: 40000 });
    await page.getByRole('button', { name: 'Save reviewed details' }).click();
    await page.getByRole('button', { name: 'Open demo selfie check' }).click();
    await page.getByRole('button', { name: 'Test failed check' }).click();
    await expect(page.getByRole('button', { name: 'Continue to SIM & plan' })).toBeDisabled();
    await page.getByRole('button', { name: 'Open demo selfie check' }).click();
    await page.getByRole('button', { name: 'Run passing demo check' }).click();
    await expect(page.getByText('Demo identity check passed.', { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `../output/qa/transaction-flow/${kind}-1.png`, fullPage: true, animations: "disabled" });
    await page.getByRole('button', { name: 'Continue to SIM & plan' }).click();
    if (kind === 'Passport') await page.getByRole('button', { name: 'Digital eSIM', exact: true }).click();
    await page.getByLabel('Assigned SIM', { exact: true }).selectOption({ index: 1 });
    await page.locator('.txn-plans button').first().click();
    const canvas = page.getByLabel('Customer signature pad');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 25, box.y + 45);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 15 });
    await page.mouse.move(box.x + 180, box.y + 45, { steps: 15 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Save allocation draft' }).click();
    await expect(page.getByText('Allocation draft saved.', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Allocate SIM & plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dispatch demo activation' })).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `../output/qa/transaction-flow/${kind}-2.png`, fullPage: true, animations: "disabled" });
    await page.getByRole('button', { name: 'Dispatch demo activation' }).click();
    await expect(page.getByRole('heading', { name: 'Demo activation successful' })).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole('list', { name: 'Transaction steps' }).locator('li')).toHaveCount(3);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download / print receipt' }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.pdf$/);
    await page.getByRole('button', { name: 'Simulate SMS dispatch' }).click();
    await expect(page.getByText('SMS dispatch simulated. No message was sent.')).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `../output/qa/transaction-flow/${kind}-3-${width}.png`, fullPage: true, animations: "disabled" });
    }
  });
}
