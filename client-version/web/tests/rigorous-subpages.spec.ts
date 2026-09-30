import {test,expect} from '@playwright/test';
import {authenticate} from './session';

test('sales, stock and administration subpages load and fit both layouts',async({page})=>{
  test.setTimeout(180000);
  const failures:string[]=[];
  page.on('pageerror',error=>failures.push(error.message));
  page.on('response',response=>{if(response.url().includes('/api/')&&response.status()>=500) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);});
  await authenticate(page);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:960});
    for(const [label,title] of [['Sales','Sales register'],['No-sale feedback','No-sale feedback'],['Targets','Targets'],['Call work queue','Ready to contact'],['Status import','Update sale statuses'],['Sales staff','Sales and call staff']]){
      await page.goto('/sales');
      await page.getByRole('navigation',{name:'Sales sections'}).getByRole('button',{name:label,exact:true}).click();
      await expect(page.getByRole('heading',{name:new RegExp('^'+title)}).first()).toBeVisible();
      await expect(page.locator('.skeleton')).toHaveCount(0, {timeout:15000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label).toBeTruthy();
      await page.screenshot({path:`../output/qa/subpages/${width}-sales-${label.replaceAll(' ','-')}.png`,fullPage:true});
      if ((process.env.RELAY_WEB_URL || '').startsWith('https:')) await page.waitForTimeout(1400);
    }
    for(const [label,title] of [['Stock register','Asset register'],['Requests','Asset requests'],['Balances & alerts','Balances & shortage alerts'],['Movements','Stock movements'],['Returns & transfers','Stock return checklist']]){
      await page.goto('/equipment');
      const nav=page.getByRole('navigation',{name:'Asset sections'});
      await nav.getByRole('button',{name:new RegExp('^'+label.replace('&','&'))}).click();
      await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(page.locator('.skeleton')).toHaveCount(0, {timeout:15000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label).toBeTruthy();
      await page.screenshot({path:`../output/qa/subpages/${width}-stock-${label.replaceAll(' ','-')}.png`,fullPage:true});
      if ((process.env.RELAY_WEB_URL || '').startsWith('https:')) await page.waitForTimeout(1400);
    }
    for(const section of ['branches','agents','customers','inventory','incentives']){
      await page.goto(`/administration?section=${section}`);
      await expect(page.getByRole('heading',{name:'Manage workspace',exact:true})).toBeVisible();
      await expect(page.locator('.admin-toolbar h2')).toHaveText(({branches:'Branches',agents:'Agents',customers:'Customers',inventory:'SIM stock',incentives:'Incentives'} as Record<string,string>)[section]);
      await expect(page.locator('.skeleton')).toHaveCount(0, {timeout:15000});
      await expect(page.getByRole('textbox',{name:'Search records'})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),section).toBeTruthy();
      await page.screenshot({path:`../output/qa/subpages/${width}-administration-${section}.png`,fullPage:true});
      if ((process.env.RELAY_WEB_URL || '').startsWith('https:')) await page.waitForTimeout(1400);
    }
  }
  expect(failures).toEqual([]);
  await page.goto('/administration?section=agents');
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await expect(page).toHaveURL(/section=customers/);
  await page.goBack();await expect(page.locator('.admin-toolbar h2')).toHaveText('Agents');
});
