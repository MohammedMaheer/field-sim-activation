import {test,expect} from '@playwright/test';
import {authenticate} from './session';

test('record names open useful details and restore focus at both widths',async({page})=>{
 await authenticate(page);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  for(const [route,title] of [['/customers','Customer directory details'],['/incentives','Incentive details'],['/field-tasks','Task details']]){
   await page.goto(route);const trigger=page.locator('.record-link').first();await expect(trigger).toBeVisible();await trigger.click();
   const d=page.getByRole('dialog',{name:title,exact:true});await expect(d).toBeVisible();
   expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
   await page.screenshot({path:`../output/qa/details-${route.slice(1)}-${width}.png`,animations:'disabled'});
   await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await expect(trigger).toBeFocused();
  }
 }
});

test('live roster fits desktop and displays valid synchronization times',async({page})=>{
 await authenticate(page);await page.goto('/live');await expect(page.locator('tbody tr').first()).toBeVisible();
 await expect(page.getByText('Invalid Date',{exact:true})).toHaveCount(0);
 const table=page.locator('.table-scroll');expect(await table.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
 await page.goto('/reports');
 const cards=page.locator('.report-card');await expect(cards.nth(4)).toBeVisible();
 const buttons=await cards.evaluateAll(els=>els.map(el=>el.querySelector('button')!.getBoundingClientRect().bottom));
 expect(Math.abs(buttons[3]-buttons[4])).toBeLessThanOrEqual(2);
});
