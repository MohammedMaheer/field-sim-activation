import {test,expect} from '@playwright/test';
import {authenticate} from './session';
test('visual audit of all edition routes',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await authenticate(page);
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:960});
  for(const route of ['/', '/live', '/agents', '/team-leaders', '/customers', '/activations', '/kyc-capture', '/inventory', '/incentives', '/field-tasks', '/support', '/reports', '/compliance', '/audit']) {
   await page.goto(route);await expect(page.locator('h1').first()).toBeVisible();
   await expect(page.locator('.skeleton').first()).toHaveCount(0,{timeout:15000});
   await expect(page.getByText('Loading assigned agents…',{exact:true})).toHaveCount(0);
   await page.waitForTimeout(400);
   if(width===390) expect(await page.locator('.page-header > div').first().evaluate(el=>el.getBoundingClientRect().height),route+' compact heading').toBeLessThan(180);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' overflow').toBeTruthy();
   await page.screenshot({path:'../output/qa/audit-visual/'+width+'-'+(route.slice(1)||'dashboard')+'.png',fullPage:true});
  }
 }
 expect(errors).toEqual([]);
});

test('mobile KPI cards retain data, sorting and drawer keyboard focus',async({page})=>{
 await authenticate(page);await page.setViewportSize({width:390,height:900});await page.goto('/team-leaders');
 await page.getByLabel('Sort records').selectOption('activations');
 await page.getByRole('button',{name:'Reverse sort direction'}).click();
 await expect(page.locator('td[data-label="Activations"]').first()).toBeVisible();
 await page.getByRole('button',{name:'View Rayan Vale',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByText('Zayn Mercer',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close details'}).focus();
 await page.keyboard.press('Shift+Tab');
 expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy();
 await page.keyboard.press('Tab');
 await expect(dialog.getByRole('button',{name:'Close details'})).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});
