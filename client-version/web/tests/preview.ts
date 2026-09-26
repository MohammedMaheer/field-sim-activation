import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Page } from '@playwright/test';

const prepared = new WeakSet<Page>();
/** Preview a built UI against the demo API without publishing assets first. */
export async function previewBuild(page: Page) {
  if (process.env.RELAY_PREVIEW_DIST !== '1' || prepared.has(page)) return;
  prepared.add(page);
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) return route.continue();
    if (request.isNavigationRequest()) {
      return route.fulfill({ contentType: 'text/html', body: await readFile(path.resolve('dist/index.html')) });
    }
    if (url.pathname.startsWith('/assets/')) {
      const name = path.basename(url.pathname);
      return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(path.resolve('dist/assets', name)) });
    }
    return route.continue();
  });
}
