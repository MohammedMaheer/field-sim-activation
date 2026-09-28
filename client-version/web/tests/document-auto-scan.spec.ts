import {test, expect} from '@playwright/test';
import {authenticate} from './session';

test('live camera reads a visible document and fills the identity form', async ({page}) => {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f6f9fc';
    context.fillRect(0, 0, 960, 600);
    context.fillStyle = '#172b40';
    context.font = '36px sans-serif';
    context.fillText('FULL NAME ALEX SAMPLE', 55, 120);
    context.fillText('ID 784-1991-1234567-1', 55, 200);
    let tick = 0;
    window.setInterval(() => {
      context.fillStyle = '#f6f9fc';
      context.fillRect(0, 0, 960, 600);
      context.fillStyle = '#172b40';
      context.fillText('FULL NAME ALEX SAMPLE', 55, 120);
      context.fillText('ID 784-1991-1234567-1', 55, 200);
      context.fillText(String(++tick), 55, 280);
    }, 100);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => canvas.captureStream(10),
    });
  });
  await page.route('**/api/kyc-captures/read-document', async route => {
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({
      name: 'ALEX SAMPLE', document_number: '784-1991-1234567-1',
      nationality: 'UNITED ARAB EMIRATES', birth_date: '1991-11-14', expiry_date: '2030-11-14',
    })});
  });
  await authenticate(page);
  await page.goto('/kyc-capture');
  await page.getByRole('button', {name: 'New transaction capture'}).click();
  await expect(page.getByText('Hold document inside frame')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Capture', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Expand scanner'}).click();
  await expect(page.getByRole('button', {name: 'Minimize scanner'})).toBeVisible();
  await page.getByRole('button', {name: 'Minimize scanner'}).click();
  await page.screenshot({path: '../output/qa/document-auto-scan-web-37.png'});
  await expect(page.getByLabel('Full name')).toHaveValue('ALEX SAMPLE', {timeout: 12000});
  await expect(page.getByLabel('Document number')).toHaveValue('784-1991-1234567-1');
  await expect(page.getByRole('button', {name: 'Expand scanner'})).toHaveCount(0);
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Scan document'}).click();
  await expect(page.getByText('Hold document inside frame')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', {name: 'Expand scanner'}).scrollIntoViewIfNeeded();
  await page.screenshot({path: '../output/qa/document-auto-scan-phone-37.png'});
});
