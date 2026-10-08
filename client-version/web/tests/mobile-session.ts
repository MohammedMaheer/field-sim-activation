import { expect, Page } from '@playwright/test';
export async function mobileSignIn(page: Page, email = 'agent1@relay.demo') {
  await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/');
  const emailBox = page.getByRole('textbox', {name: 'Work email'});
  const accountPicker = page.getByRole('combobox', {name: /^Account\b/})
    .or(page.getByRole('button', {name: /^Account\b/}));
  await expect(emailBox.or(accountPicker).first()).toBeVisible({timeout: 60000});

  if (await accountPicker.isVisible()) {
    await accountPicker.click();
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const accountName = new RegExp(escapedEmail, 'i');
    const accountOption = page.getByRole('option', {name: accountName})
      .or(page.getByRole('menuitem', {name: accountName}))
      .or(page.getByRole('button', {name: accountName}));
    const popup = page.getByRole('menu', {name: 'Popup menu'});
    if (await popup.isVisible()) {
      await popup.hover();
      await page.mouse.wheel(0, -2000);
      for (let attempt = 0; attempt < 12 && !(await accountOption.last().isVisible()); attempt += 1) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(150);
      }
    }
    await expect(accountOption.last()).toBeVisible();
    await accountOption.last().click();
    await expect(page.getByRole('textbox', {name: 'Password'})).toHaveCount(0);
  } else {
    await emailBox.click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(email, {delay: 75});
    const password = page.getByRole('textbox', {name: 'Password'});
    await password.click();
    await page.waitForTimeout(250);
    await page.keyboard.type(process.env.DEMO_PASSWORD!, {delay: 100});
    await page.waitForTimeout(250);
  }

  const signIn = page.getByRole('button', {name: 'Sign in to Relay', exact: true});
  await signIn.click();
  await expect(emailBox.or(accountPicker).first()).toBeHidden({timeout: 30000});
  await expect(signIn).toBeHidden({timeout: 30000});
}
