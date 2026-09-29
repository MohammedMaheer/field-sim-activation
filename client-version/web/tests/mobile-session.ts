import { expect, Page } from '@playwright/test';
export async function mobileSignIn(page: Page, email = 'agent1@relay.demo') {
  await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/');
  await expect(page.getByRole('textbox', {name:'Work email'})).toBeVisible({timeout:60000});
  const emailBox=page.getByRole('textbox',{name:'Work email'}); await emailBox.click(); await page.waitForTimeout(250); await page.keyboard.press('Control+A'); await page.keyboard.type(email,{delay:75});
  const pass=page.getByRole('textbox',{name:'Password'}); await pass.click(); await page.waitForTimeout(250); await page.keyboard.type(process.env.DEMO_PASSWORD!,{delay:100}); await page.waitForTimeout(250);
  await page.getByRole('button', {name:'Sign in to Relay',exact:true}).click();
  await expect(page.getByRole('textbox', {name:'Work email'})).toBeHidden({timeout:30000});
}
