import {expect,Page,BrowserContext} from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
export async function authenticate(page:Page) {
 if(cookies.length) await page.context().addCookies(cookies);
 await page.goto('/');
 const heading=page.getByRole("heading",{name:"Operations overview"});
 const password=page.locator('input[type="password"]');
 await expect(heading.or(password)).toBeVisible({timeout:15000});
 if(await password.isVisible()) {
  await page.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD || 'RelayDemo!2026');
  await page.getByRole('button',{name:'Sign in to workspace'}).click();
 }
 await expect(heading).toBeVisible();
 cookies=await page.context().cookies();
}
export async function remember(page:Page) { cookies=await page.context().cookies(); }
