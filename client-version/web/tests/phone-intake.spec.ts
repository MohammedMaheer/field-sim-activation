import {test,expect} from '@playwright/test';
test('phone identity capture and SIM stage',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.MOBILE_PREVIEW_URL||'http://127.0.0.1:5188/mobile-demo/');await expect(page.getByText('Your day, at a glance',{exact:true})).toBeVisible({timeout:60000});await page.getByRole('tab',{name:'Receipts',exact:true}).click();await expect(page.getByRole('heading',{name:'New transaction'})).toBeVisible();
 const scanButton=page.getByRole('button',{name:'Scan document',exact:true});await scanButton.click();await page.waitForTimeout(350);await page.screenshot({path:'../output/qa/phone-intake-scanning.png',fullPage:true});await expect(scanButton).toBeEnabled({timeout:15000});await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled({timeout:15000});await page.mouse.move(450,100);await page.waitForTimeout(300);await page.screenshot({path:'../output/qa/phone-intake-identity.png',fullPage:true});
 async function reveal(name:string){const target=page.getByRole('button',{name,exact:true});for(let i=0;i<18;i++){const b=await target.boundingBox({timeout:200}).catch(()=>null),h=(await page.locator('#flutter-host').boundingBox())!;if(b&&b.y>=h.y&&b.y+b.height<h.y+h.height)return target;await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.wheel(0,220);await page.waitForTimeout(150);}return target;}
 await(await reveal('Continue')).click();
 const serial=page.getByLabel('SIM serial / ICCID',{exact:true});
 const scanSim=page.getByRole('button',{name:'Scan SIM barcode',exact:true});
 await expect(serial).toBeVisible();await expect(scanSim).toBeVisible();
 const serialBox=await serial.boundingBox(),scanBox=await scanSim.boundingBox();
 expect(serialBox&&scanBox).toBeTruthy();expect(Math.abs(serialBox!.y-scanBox!.y)).toBeLessThan(8);
 await page.screenshot({path:'../output/qa/phone-intake-sim.png',fullPage:true});expect(errors).toEqual([]);
});
