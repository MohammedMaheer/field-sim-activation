import {test,expect} from '@playwright/test';
import {authenticate} from './session';

test('record names open useful details and restore focus at both widths',async({page})=>{
 let authorization = '';
 page.on('request', request => {
  if (request.url().includes('/api/') && request.headers().authorization) authorization = request.headers().authorization;
 });
 await authenticate(page);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});
  for(const [route,title] of [['/customers','Customer directory details'],['/incentives','Incentive details']]){
   await page.goto(route);
   if(route==='/incentives') {
    // Current-month entries can be empty after the calendar changes. Inspect a
    // recorded period without creating incentives or changing client formulas.
    await expect(page.getByRole('heading',{name:'Incentive history',exact:true})).toBeVisible();
    const response=await page.request.get('/api/incentives',{headers:{Authorization:authorization}});
    expect(response.ok()).toBeTruthy();
    const records=await response.json();
    if(!records.length) {
     await expect(page.getByRole('heading',{name:'No records yet',exact:true})).toBeVisible();
     await expect(page.locator('.record-link')).toHaveCount(0);
     continue;
    }
    await page.getByRole('textbox',{name:'Month',exact:true}).fill(records[0].period);
   }
   const trigger=page.locator('.record-link').first();await expect(trigger).toBeVisible();await trigger.click();
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
 const cards=page.locator('.report-card').filter({has:page.getByRole('button',{name:'CSV',exact:true})});
 await expect(cards.first()).toBeVisible();
 const positions=await cards.evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.querySelector('button')!.getBoundingClientRect().bottom})));
 expect(positions.length).toBeGreaterThanOrEqual(5);
 let alignedPairs=0;
 for(let i=0;i<positions.length;i++) for(let j=i+1;j<positions.length;j++) {
  if(Math.abs(positions[i].top-positions[j].top)<2) {
   expect(Math.abs(positions[i].bottom-positions[j].bottom)).toBeLessThanOrEqual(2);
   alignedPairs++;
  }
 }
 expect(alignedPairs).toBeGreaterThan(0);
});
