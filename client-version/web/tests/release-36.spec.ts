import { test, expect } from '@playwright/test';
import { authenticate } from './session';

test('client workspace exposes branch agents, verification and stock controls', async ({page}) => {
  await authenticate(page);
  for (const name of ['Branches', 'Agents', 'Backend verification', 'SIM inventory', 'Support']) {
    await expect(page.getByRole('link', {name, exact:true})).toBeVisible();
  }
  for (const name of ['Field tasks', 'Branch teams', 'Compliance']) {
    await expect(page.getByRole('link', {name, exact:true})).toHaveCount(0);
  }
  await page.getByRole('link', {name:'Branches', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Branches', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Add branch'})).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('link', {name:'SIM inventory', exact:true}).click();
  await page.getByRole('button', {name:'Import Excel'}).click();
  const drawer = page.getByRole('dialog', {name:'Import SIM stock'});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', {name:'Download Excel template'})).toBeVisible();
  await expect(drawer.getByLabel('Branch')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByRole('link', {name:'Backend verification', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Backend verification', exact:true})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Submissions for verification'})).toBeVisible();
  await page.getByRole('link', {name:'Support', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Support & help'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Send request'})).toHaveCount(0);
});

test('responsive client pages fit the viewport', async ({page}) => {
  test.setTimeout(180000);
  await authenticate(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height:900});
    for (const route of ['/', '/branches', '/agents', '/kyc-capture', '/inventory', '/plans', '/support', '/customers', '/activations', '/incentives', '/reports', '/audit', '/administration', '/live']) {
      await page.goto(route);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} at ${width}px`).toBeTruthy();
      await page.waitForTimeout(700);
      await page.screenshot({path:`../output/qa/pages39-${route.replace(/\//g,'') || 'overview'}-${width}.png`});
    }
  }
});
