import { Page } from '@playwright/test';

export async function mockStageResult(page: Page, stage: string, result: () => unknown) {
  await page.route('**/api/kyc-captures/ocr-jobs', async route => {
    const job = route.request().postDataJSON();
    if (job.stage !== stage) return route.fallback();
    await route.fulfill({status: 202, json: {
      id: job.operation_id, stage, status: 'COMPLETED', result: result(), error: '', retry_after: 0,
    }});
  });
}
