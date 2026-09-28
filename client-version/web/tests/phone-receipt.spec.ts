import {test,expect} from '@playwright/test';
test('phone pending receipt paper reveal and PDF download',async({page})=>{
 test.setTimeout(90000);
 await page.goto(process.env.MOBILE_PREVIEW_URL||'http://127.0.0.1:5188/mobile-demo/');
 await expect(page.getByText('Your day, at a glance',{exact:true})).toBeVisible({timeout:60000});
 await page.getByRole('tab',{name:'Capture',exact:true}).click();
 await page.getByRole('button',{name:'History',exact:true}).click();
 await page.getByRole('button',{name:'DEMO-RECEIPT-002 SUBMITTED',exact:true}).click();
 await expect(page.getByRole('group',{name:/^FINAL REVIEW PENDING/}).or(page.getByText(/^FINAL REVIEW PENDING/))).toBeVisible();
 await page.waitForTimeout(850);
 await page.screenshot({path:'../output/qa/phone-receipt-pending.png',fullPage:true});
 const host=(await page.locator('#flutter-host').boundingBox())!;
 const share=page.getByRole('button',{name:'Download / share receipt',exact:true});
 for(let i=0;i<15;i++){const b=await share.boundingBox({timeout:200}).catch(()=>null);if(b&&b.y+b.height<host.y+host.height)break;await page.mouse.move(host.x+host.width/2,host.y+host.height/2);await page.mouse.wheel(0,200);await page.waitForTimeout(150);}
 const download=page.waitForEvent('download');await share.click();expect((await download).suggestedFilename()).toMatch(/pdf$/);
 await page.getByRole('button',{name:'Done · Return to dashboard',exact:true}).click();
 await expect(page.getByText('Your day, at a glance',{exact:true})).toBeVisible();
});
