import {test,expect} from '@playwright/test';
import {authenticate,remember} from './session';
test.beforeEach(async({page})=>authenticate(page));
test.afterEach(async({page})=>remember(page));
test('agent popup tabs, ping, keyboard focus and close work',async({page})=>{
 await page.getByRole('link',{name:'Agents',exact:true}).click();
 await page.getByRole('button',{name:'View Zayn Mercer',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Ping device',exact:true}).click();
 for(const name of ['Activations','Inventory','Compliance','Audit history','Overview']) await dialog.getByRole('button',{name,exact:true}).click();
 await dialog.getByRole('button',{name:'Close details'}).focus();
 await page.keyboard.press('Shift+Tab');
 expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy();
 await dialog.getByRole('button',{name:'Close details'}).click();await expect(dialog).toHaveCount(0);
});
test('compliance popup validates and saves investigation',async({page})=>{
 await page.getByRole('link',{name:'Compliance !',exact:true}).click();
 await page.getByRole('button',{name:'View record'}).first().click();
 const d=page.getByRole('dialog',{name:'Compliance investigation'});
 await d.getByRole('button',{name:'Save investigation'}).click();await expect(d).toBeVisible();
 await d.getByLabel('Investigation note').fill('Synthetic popup QA investigation');
 const saved=page.waitForResponse(r=>r.url().includes('/api/compliance/')&&r.request().method()==='PATCH');
 await d.getByRole('button',{name:'Save investigation'}).click();expect((await saved).status()).toBe(200);await expect(d).toHaveCount(0);
});
test('phone-width popup actions and backdrop restore navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Toggle navigation'}).click();
 await page.getByRole('link',{name:'Agents',exact:true}).click();
 await page.getByRole('button',{name:'View Zayn Mercer'}).click();
 const d=page.getByRole('dialog');await d.getByRole('button',{name:'Inventory',exact:true}).click();
 expect(await d.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth)).toBeTruthy();
 await d.getByRole('button',{name:'Close details'}).click();await expect(d).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle navigation'}).click();await expect(page.getByRole('link',{name:'Activations',exact:true})).toBeVisible();
});
