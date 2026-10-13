import { expect, test } from '@playwright/test';
import path from 'node:path';

test.beforeEach(() => {
  const url = new URL(process.env.RELAY_WEB_URL || 'http://localhost:5174');
  test.skip(process.env.RELAY_ALLOW_SETUP_TEST !== '1' || !['127.0.0.1', 'localhost'].includes(url.hostname), 'Explicit disposable local API only');
});

test('configured boundary connects management, member shift, outside capture, notification and exports', async ({ browser, request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: 'admin@relay.demo', password: process.env.DEMO_PASSWORD!, native: true } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await auth.json()).access_token}` };
  const agentAuth = await request.post('/api/auth/login', { data: { email: 'agent1@relay.demo', password: process.env.DEMO_PASSWORD!, native: true } });
  const agentLogin = await agentAuth.json();
  const agent = agentLogin.user;
  const agentHeaders = { Authorization: `Bearer ${agentLogin.access_token}` };
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 25.08, longitude: 55.141, accuracy: 5 }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/');
    await page.getByLabel('Work email', { exact: true }).fill('admin@relay.demo');
    await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in to workspace' }).click();
    await page.getByRole('link', { name: 'Work locations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Locations & work boundaries' })).toBeVisible();
    const existingFences = await request.get('/api/location-tracking/fences', { headers });
    const existing = (await existingFences.json()).find((row: any) => row.branch_id === agent.branch_id);
    await page.getByRole('button', { name: existing ? `Edit ${existing.name}` : 'Add boundary', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Boundary name').fill('Explicit isolated connected worksite');
    await dialog.getByLabel('Applies to branch').selectOption(agent.branch_id);
    await dialog.getByLabel('Latitude', { exact: true }).fill('25.08');
    await dialog.getByLabel('Longitude', { exact: true }).fill('55.141');
    await dialog.getByLabel('Boundary radius slider').fill('500');
    await dialog.getByLabel('Boundary is active', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Save boundary', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const fences = await request.get('/api/location-tracking/fences', { headers });
    const fence = (await fences.json()).find((row: any) => row.branch_id === agent.branch_id);
    expect(fence.radius_m).toBe(500);
    expect((await request.patch('/api/location-tracking/settings', { headers, data: { enabled: true } })).ok()).toBeTruthy();
    await page.getByTitle('Sign out', { exact: true }).click();
    await page.getByLabel('Work email', { exact: true }).fill('agent1@relay.demo');
    await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in to workspace' }).click();
    await page.getByRole('link', { name: 'Work locations', exact: true }).click();
    await page.getByRole('button', { name: 'Start work tracking', exact: true }).click();
    await expect(page.getByRole('button', { name: 'End work tracking', exact: true })).toBeVisible();
    await expect(page.getByText('Inside boundary', { exact: true }).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.resolve('../output/qa/geofence80-connected-inside.png') });
    await context.setGeolocation({ latitude: 25.1, longitude: 55.141, accuracy: 5 });
    // Refresh shares the real API session; wait through its deliberate short point-rate bound.
    await expect.poll(async () => {
      await page.getByRole('button', { name: 'Update my location', exact: true }).click();
      return await page.getByText('Outside boundary', { exact: true }).count();
    }, { intervals: [1600, 1600, 2000], timeout: 12000 }).toBeGreaterThan(0);
    await page.getByRole('link', { name: 'New transaction', exact: true }).click();
    await expect(page.getByText(/outside your assigned work boundary/i).first()).toBeVisible();
    let queued = 0;
    page.on('request', req => { if (new URL(req.url()).pathname === '/api/kyc-captures/ocr-jobs' && req.method() === 'POST') queued++; });
    await page.getByLabel('Customer details screen', { exact: true }).setInputFiles(path.resolve('tests/fixtures/transaction-sample.png'));
    await expect(page.getByRole('alert').first()).toContainText(/outside/i);
    expect(queued).toBe(0);
    const memberResponse = await request.get('/api/location-tracking/members', { headers });
    const member = (await memberResponse.json()).items.find((row: any) => row.user_id === agent.id);
    expect(member.latest_location.state).toBe('OUTSIDE');
    expect(member.latest_location.captured_at).toMatch(/(?:Z|\+00:00)$/);
    const notices = await request.get('/api/notifications', { headers });
    expect(JSON.stringify(await notices.json())).toContain('Outside work boundary');
    const exported = await request.get(`/api/location-tracking/export?format=csv&user_id=${agent.id}`, { headers });
    expect(exported.ok()).toBeTruthy();
    const csv = await exported.text();
    expect(csv).toContain('Boundary radius (m)');
    expect(csv).toContain('OUTSIDE');
    expect(csv).toContain('Explicit isolated connected worksite');
    const xlsx = await request.get(`/api/location-tracking/export?format=xlsx&user_id=${agent.id}`, { headers });
    expect(xlsx.ok()).toBeTruthy();
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');
    await page.getByRole('link', { name: 'Work locations', exact: true }).click();
    await page.getByRole('button', { name: 'End work tracking', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start work tracking', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await request.patch('/api/location-tracking/settings', { headers, data: { enabled: false } });
    const state = await request.get('/api/location-tracking/me', { headers: agentHeaders });
    const session = (await state.json()).work_session;
    if (session) await request.post('/api/location-tracking/end', { headers: agentHeaders, data: { session_id: session.id } });
    await context.close();
  }
});
