import {expect, Page, test} from '@playwright/test';
import {mobileSignIn} from './mobile-session';

const previewUrl = process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5176/mobile-demo/';
const accounts = [
  {email: 'agent1@relay.demo', name: 'Zayn Mercer', role: 'Field Agent', branch: 'Marina Branch'},
  {email: 'leader@relay.demo', name: 'Rayan Vale', role: 'Team Leader', branch: 'Downtown Branch'},
  {email: 'admin@relay.demo', name: 'Alex Morgan', role: 'Administrator', branch: null},
  {email: 'agent2@relay.demo', name: 'Leila Arden', role: 'Field Agent', branch: 'Downtown Branch'},
  {email: 'leader2@relay.demo', name: 'Mira Rowan', role: 'Team Leader', branch: 'Marina Branch'},
  {email: 'ops@relay.demo', name: 'Evan Reid', role: 'Operations Manager', branch: null},
  {email: 'inventory@relay.demo', name: 'Sana Wells', role: 'Inventory Manager', branch: null},
  {email: 'compliance@relay.demo', name: 'Nora Blake', role: 'Compliance Officer', branch: null},
  {email: 'salesmanager@relay.demo', name: 'Owen Hart', role: 'Sales Manager', branch: 'Marina Branch'},
  {email: 'tele@relay.demo', name: 'Sam Lane', role: 'Tele Verification Officer', branch: null},
  {email: 'welcome@relay.demo', name: 'Aria Reed', role: 'Welcome Call Officer', branch: null},
];

async function mockPreviewApi(page: Page) {
  const loginBodies: unknown[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let response: unknown = [];
    if (path === '/auth/mobile-demo/accounts') {
      response = accounts;
    } else if (path === '/auth/mobile-demo/login') {
      const body = request.postDataJSON();
      loginBodies.push(body);
      const account = accounts.find(row => row.email === body.email);
      if (!account) {
        await route.fulfill({status: 403, json: {detail: 'This account is not available.'}});
        return;
      }
      response = {
        access_token: 'synthetic-mobile-access',
        refresh_token: 'synthetic-mobile-refresh',
        user: {...account, id: `sample-${account.email}`, agent_id: 'sample-agent', permissions: ['read', 'ekyc.write']},
      };
    } else if (path === '/auth/refresh') {
      await route.fulfill({status: 401, json: {detail: 'Sign in required'}});
      return;
    } else if (path === '/health') {
      response = {status: 'ok'};
    } else if (path === '/dashboard') {
      response = {agents: [], target: 0, kyc_pending_review: 0, kyc_today: 0, recent: [], trend: [], aht: 0, ekyc: 0, sales_summary: {achievement: 0}};
    } else if (path === '/notifications') {
      response = {items: [], unread: 0, categories: ['Transactions', 'Workspace']};
    } else if (path === '/sales-management/call-tasks/summary') {
      response = {actionable: 0};
    }
    await route.fulfill({json: response});
  });
  return loginBodies;
}

test('mobile demo starts with a prefilled account and signs in without a password', async ({page}) => {
  const loginBodies = await mockPreviewApi(page);
  await page.goto(previewUrl);
  await expect(page.getByRole('button', {name: 'Sign in to Relay', exact: true})).toBeEnabled({timeout: 60000});
  await expect(page.getByText('agent1@relay.demo', {exact: true})).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Work email'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Password'})).toHaveCount(0);
  await page.waitForTimeout(500); // Capture the settled color transition.
  await page.screenshot({path: '../output/qa/mobile-demo-account-sign-in.png'});
  await page.getByRole('button', {name: /^Account\b/}).click();
  await expect(page.getByRole('menuitem', {name: /leader@relay\.demo/})).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({path: '../output/qa/mobile-demo-account-options.png'});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', {name: 'Popup menu'})).toBeHidden();
  await page.getByRole('button', {name: 'Sign in to Relay', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Start transaction', exact: true})).toBeVisible({timeout: 30000});
  expect(loginBodies).toEqual([{email: 'agent1@relay.demo'}]);
});

test('mobile demo account selection opens the selected role workspace', async ({page}) => {
  const loginBodies = await mockPreviewApi(page);
  await mobileSignIn(page, 'leader@relay.demo');
  await expect(page.getByRole('group', {name: 'Branch updates', exact: true})).toBeVisible({timeout: 30000});
  await expect(page.getByRole('button', {name: 'Start transaction', exact: true})).toHaveCount(0);
  expect(loginBodies).toEqual([{email: 'leader@relay.demo'}]);
});

test('mobile demo can select an account below the first dropdown page', async ({page}) => {
  const loginBodies = await mockPreviewApi(page);
  await mobileSignIn(page, 'welcome@relay.demo');
  await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
  expect(loginBodies).toEqual([{email: 'welcome@relay.demo'}]);
});

test('admin portal still requires normal email and password sign-in', async ({page}) => {
  let previewRequests = 0;
  await page.route('**/api/**', async route => {
    if (route.request().url().includes('/auth/mobile-demo/')) previewRequests += 1;
    await route.fulfill({status: 401, json: {detail: 'Sign in required'}});
  });
  await page.goto('/');
  await expect(page.locator('input[type=email]')).toBeVisible();
  await expect(page.locator('input[type=password]')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sign in to workspace', exact: true})).toBeVisible();
  expect(previewRequests).toBe(0);
});
