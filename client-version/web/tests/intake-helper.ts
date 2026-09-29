import {Page,expect} from '@playwright/test';
import path from 'node:path';
export async function fillIntake(page:Page){
 await expect(page.getByRole('heading',{name:'Customer identity',exact:true})).toBeVisible();
 await page.getByLabel('Identity document',{exact:true}).setInputFiles(path.resolve('../mobile/assets/demo/identity.png'));
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled({timeout:60000});
 await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Avery Stone');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('SIM serial / ICCID',{exact:true}).fill('SAMPLE-SIM-001');await page.getByLabel('Phone number',{exact:true}).fill('SAMPLE-PHONE');await page.locator('.intake-plans button').first().click();const canvas=page.locator('canvas');await canvas.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(300);const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+20,box.y+50);await page.mouse.down();for(let i=1;i<14;i++)await page.mouse.move(box.x+20+i*8,box.y+50+(i%3)*8);await page.mouse.up();await page.getByRole('button',{name:'Continue',exact:true}).click();
}
