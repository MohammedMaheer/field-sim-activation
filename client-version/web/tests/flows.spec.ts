import {test,expect} from '@playwright/test';
import {authenticate,remember} from './session';
test.beforeEach(async({page})=>authenticate(page));
test.afterEach(async({page})=>remember(page));

test('navigation, filters, pagination and drawer keyboard recovery',async({page})=>{
 await page.getByRole('link',{name:'Agents',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Agent management',exact:true}).first()).toBeVisible();
 await page.getByRole('textbox',{name:'Search records'}).fill('Leila');
 await expect(page.getByRole('cell',{name:/Leila Arden/}).first()).toBeVisible();
 await page.getByRole('button',{name:'View Leila Arden'}).click();
 await expect(page.getByRole('dialog',{name:'Agent workspace'})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('textbox',{name:'Search records'}).fill('NO-SUCH-AGENT');
 await expect(page.getByText('No matching records')).toBeVisible();
 await page.getByRole('textbox',{name:'Search records'}).fill('');
 await page.getByRole('button',{name:'Next page'}).click();
 await expect(page.getByText('Showing 9–12 of 12')).toBeVisible();
});
