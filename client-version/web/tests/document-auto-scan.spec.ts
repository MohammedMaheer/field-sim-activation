import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {authenticate} from './session';

test('camera frames reach real extraction and fill the customer form automatically',async({page})=>{
  test.setTimeout(120000);
  const fixture=(await readFile('../mobile/assets/demo/identity.png')).toString('base64');
  await page.addInitScript(async(base64)=>{
    const canvas=document.createElement('canvas'),image=new Image();
    image.src='data:image/png;base64,'+base64;
    await image.decode();canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;
    context.drawImage(image,0,0);
    window.setInterval(()=>context.drawImage(image,0,0),100);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>canvas.captureStream(10)});
  },fixture);
  await authenticate(page);await page.goto('/kyc-capture');
  await page.getByRole('button',{name:'New transaction capture',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Hold screen inside frame'})).toBeVisible();
  await page.getByRole('button',{name:'Expand scanner',exact:true}).click();
  await expect(page.getByRole('button',{name:'Minimize scanner',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Minimize scanner',exact:true}).click();
  await expect(page.getByLabel('Full name',{exact:true})).not.toHaveValue('',{timeout:60000});
  await expect(page.getByLabel('Document number',{exact:true})).not.toHaveValue('');
  await expect(page.getByRole('button',{name:'Expand scanner',exact:true})).toHaveCount(0);
  await page.screenshot({path:'../output/qa/rigorous-auto-customer-capture.png'});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Order & plan',exact:true})).toBeVisible();
});
