import {test,expect} from '@playwright/test';
import {authenticate} from './session';
import path from 'node:path';
test('real screenshot upload, VPS OCR, editable rows, Excel and backend status',async({page,request})=>{
 test.setTimeout(120000);await authenticate(page);await page.goto('/screenshot-capture');
 const reference='DEMO-WEB-'+Date.now();
 await page.getByLabel('Source transaction reference',{exact:true}).fill(reference);
 await page.getByLabel('Upload screenshot',{exact:true}).setInputFiles(path.resolve('tests/fixtures/transaction-sample.png'));
 await page.getByRole('button',{name:'Upload & run VPS OCR',exact:true}).click();
 await expect(page.locator('.capture-detail .badge').first()).toHaveText('extracted',{timeout:65000});
 await expect(page.locator('.transaction-stages [aria-current="step"]')).toContainText('Review details');
 await page.getByText(/Extracted text ·/).click();
 await expect(page.locator('.ocr-lines')).toContainText('Jordan Demo');
 if(!await page.getByLabel('Transaction reference',{exact:true}).count()) await page.getByRole('button',{name:'Add OCR line 2',exact:true}).click();
 await page.getByLabel('Transaction reference',{exact:true}).first().fill('DEMO-TXN-001');
 await page.getByLabel('Customer',{exact:true}).first().fill('Jordan Demo');
 await page.getByLabel('Account / MSISDN',{exact:true}).first().fill('0000123');
 await page.getByRole('button',{name:'Save & validate rows',exact:true}).click();
 await expect(page.locator('.capture-detail .badge').first()).toHaveText('validated');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Generate Excel',exact:true}).click();expect((await dl).suggestedFilename()).toMatch(/\.xlsx$/);
 await page.getByRole('button',{name:'Submit to backend team',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Awaiting backend review',exact:true})).toBeVisible();
 await expect(page.locator('.transaction-stages [aria-current="step"]')).toContainText('Submit & track');
 const auth=await request.post('/api/auth/login',{data:{email:'compliance@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});expect(auth.ok()).toBeTruthy();const headers={Authorization:'Bearer '+(await auth.json()).access_token};
 const list=await (await request.get('/api/kyc-captures',{headers})).json();const capture=list.find((r:any)=>r.source_reference===reference);expect(capture).toBeTruthy();
 const reviewed=await request.post('/api/kyc-captures/'+capture.id+'/review',{headers,data:{version:capture.version,outcome:'VERIFIED',reason:'Screenshot matches reviewed transaction row'}});expect(reviewed.ok()).toBeTruthy();
 await expect(page.locator('.capture-detail .badge').first()).toHaveText('verified',{timeout:15000});
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'../output/qa/capture-web-'+width+'.png',fullPage:true});}
});
