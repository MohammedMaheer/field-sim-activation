import {test,expect} from '@playwright/test';
import {authenticate} from './session';

test('report shortcut remains a usable control at desktop and phone widths',async({page})=>{
  await authenticate(page);
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:960});
    await page.goto('/reports');
    const link=page.getByRole('link',{name:'Open sales reports & Excel export'});
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await page.screenshot({path:`../output/qa/reports-control-${width}.png`,fullPage:true});
    await link.click();
    await expect(page.getByRole('heading',{name:'Sales management',exact:true})).toBeVisible();
  }
});

test('failed sales requests show recovery and load after the connection returns',async({page})=>{
  await authenticate(page);
  await page.route('**/api/sales-management/sales?**',route=>route.abort('internetdisconnected'));
  await page.goto('/sales');
  const retry=page.getByRole('button',{name:'Try again',exact:true});
  await expect(retry).toBeVisible({timeout:20000});
  await page.unroute('**/api/sales-management/sales?**');
  await retry.click();
  await expect(page.locator('.sale-detail-link').first()).toBeVisible({timeout:15000});
  await expect(retry).toHaveCount(0);
});
