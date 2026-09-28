import {test,expect} from '@playwright/test';
test('isolated Flutter phone preview',async({page})=>{
 test.setTimeout(120000);
 const errors:string[]=[];const apiCalls:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/'))apiCalls.push(r.url());});
 await page.goto(process.env.MOBILE_PREVIEW_URL || 'http://127.0.0.1:5188/mobile-demo/');
 await expect(page.getByText('Your day, at a glance',{exact:true})).toBeVisible({timeout:60000});
 await page.screenshot({path:'../output/qa/phone-preview-desktop.png',fullPage:true});
 await page.getByRole('tab',{name:'Tasks',exact:true}).click();
 await expect(page.getByText('My field tasks',{exact:true})).toBeVisible();
 await page.getByText('Mark complete',{exact:true}).first().click();
 await page.getByRole('tab',{name:'Stock',exact:true}).click();
 await expect(page.getByText('My SIM stock',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Profile',exact:true}).click();
 await expect(page.getByText('My workspace',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Receipts',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Activation receipt'})).toBeVisible();
 const host=await page.locator('#flutter-host').boundingBox();
 await page.mouse.move(host!.x+host!.width/2,host!.y+host!.height/2);
 await page.mouse.wheel(0,420);await page.waitForTimeout(300);
 await page.getByRole('button',{name:'Upload',exact:true}).click();
 await page.getByRole('button',{name:'Upload & run VPS OCR',exact:true}).click();
 await expect(page.getByText('Transaction rows',{exact:true})).toBeVisible();
 await page.screenshot({path:'../output/qa/phone-preview-receipt.png',fullPage:true});
 async function reveal(name:string){
  const button=page.getByRole('button',{name,exact:true});
  for(let i=0;i<14;i++){
   const b=await button.boundingBox({timeout:250}).catch(()=>null);const h=await page.locator('#flutter-host').boundingBox();
   if(b&&h&&b.y>=h.y&&b.y+b.height<=h.y+h.height)return button;
   await page.mouse.move(h!.x+h!.width/2,h!.y+h!.height/2);await page.mouse.wheel(0,240);await page.waitForTimeout(100);
  }
  return button;
 }
 await page.waitForTimeout(800);
 await (await reveal('Save & validate rows')).click();
 const download=page.waitForEvent('download');
 await (await reveal('Generate / share Excel')).click();
 expect((await download).suggestedFilename()).toMatch(/xlsx$/);
 await (await reveal('Submit to backend team')).click();
 await expect(page.getByText(/VERIFIED: Simulated reviewer approval/)).toBeAttached({timeout:20000});
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('tab',{name:'Home',exact:true}).click();
 for(const [button,heading] of [['Customers','Customer directory'],['Daily report','Daily report'],['Incentives','My incentives'],['Need field support?','Support']] as const){
  await (await reveal(button)).click();
  await page.waitForTimeout(250);
  await expect(page.getByRole('button',{name:'Back',exact:true})).toBeVisible();
  await page.screenshot({path:`../output/qa/phone-preview-${button.replace(/[^a-z]/gi,'')}.png`,fullPage:true});
  await page.getByRole('button',{name:'Back',exact:true}).click();
 }
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'↻ Reset demo',exact:true}).click();
 await expect(page.getByText('Your day, at a glance',{exact:true})).toBeVisible({timeout:30000});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.phone').scrollIntoViewIfNeeded();
 await page.screenshot({path:'../output/qa/phone-preview-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'↗ Expand app',exact:true}).click();
 await expect(page.locator('body')).toHaveClass('expanded');
 await page.getByRole('button',{name:'Exit expanded view'}).click();
 expect(apiCalls).toEqual([]);expect(errors).toEqual([]);
});
