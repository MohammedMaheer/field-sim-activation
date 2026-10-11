import { expect, test, Page } from '@playwright/test';
import path from 'node:path';
import { previewBuild } from './preview';

async function setup(page: Page) {
  await previewBuild(page);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let data: any = [];
    if (url.pathname === '/api/auth/refresh') data = {access_token: 'synthetic-access', user: {id:'ops', name:'Operations', role:'Operations Manager', permissions:['read','ekyc.write'], agent_id:'sales-agent'}};
    if (url.pathname === '/api/kyc-captures/draft') data = {version:1,data:{}};
    if (url.pathname === '/api/resources/agents') data = [{id:'sales-agent',name:'Sales Agent',branch_id:'branch-one'}];
    if (url.pathname === '/api/resources/plans') data = [{id:'plan-one',name:'First printed plan'}];
    if (url.pathname === '/api/notifications') data = {items:[],categories:[],unread:0};
    if (url.pathname === '/api/events/stream') return route.fulfill({contentType:'text/event-stream',body:''});
    await route.fulfill({json:data});
  });
  await page.goto('/kyc-capture');
  await page.getByRole('button',{name:'New transaction capture',exact:true}).click();
}
const customer = {name:'Avery Stone', document_number:'SAMPLE-ID-001', nationality:'United Arab Emirates',birth_date:'1990-01-01',expiry_date:'2031-12-31',document_check:'synthetic-proof'};

test('busy upload retains photo and reuses one operation through the queue', async ({page}) => {
  await setup(page);
  const operations:string[]=[];
  let reads=0;
  await page.route('**/api/kyc-captures/ocr-jobs',async route=>{
    const body=route.request().postDataJSON(); operations.push(body.operation_id);
    if(operations.length===1) return route.fulfill({status:429,json:{detail:'Scanner queue busy'}});
    await route.fulfill({status:202,json:{id:'job-one',stage:'DOCUMENT',status:'QUEUED',retry_after:1}});
  });
  await page.route('**/api/kyc-captures/ocr-jobs/job-one',route=>route.fulfill({json:{id:'job-one',stage:'DOCUMENT',status:++reads===1?'PROCESSING':'COMPLETED',result:customer,retry_after:1}}));
  await page.getByLabel('Customer details screen',{exact:true}).setInputFiles(path.resolve('../mobile/assets/demo/identity.png'));
  await expect(page.getByText('Photo retained · waiting to reconnect…',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Avery Stone',{timeout:15000});
  expect(new Set(operations).size).toBe(1);
  await page.screenshot({path:'../output/qa/ocr76-customer-queued-completed.png'});
});

test('replacement order clears its old plan and charges while preserving customer',async({page})=>{
  await setup(page); let orders=0;
  await page.route('**/api/kyc-captures/ocr-jobs',route=>{
    const body=route.request().postDataJSON();
    const result=body.stage==='DOCUMENT'?customer:(++orders===1?{order_type:'NEW',package_name:'First printed plan',plan_id:'plan-one',plan_name:'First printed plan',msisdn:'0500000000',order_reference:'REQ-12345',monthly_cost:'350',prepayment:'0',order_check:'first-proof'}:{package_name:'Unlisted printed plan',msisdn:'0500000000',order_reference:'REQ-54321',order_check:'second-proof'});
    return route.fulfill({status:202,json:{id:body.operation_id,stage:body.stage,status:'COMPLETED',result}});
  });
  const fixture=path.resolve('../mobile/assets/demo/identity.png');
  await page.getByLabel('Customer details screen',{exact:true}).setInputFiles(fixture);
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Avery Stone');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Order details screen',{exact:true}).setInputFiles(fixture);
  await expect(page.getByLabel('Monthly charge',{exact:true})).toHaveValue('350');
  await page.getByLabel('Order details screen',{exact:true}).setInputFiles(path.resolve('../mobile/assets/demo/order.png'));
  await expect(page.getByLabel('Request ID',{exact:true})).toHaveValue('REQ-54321');
  await expect(page.getByLabel('Monthly charge',{exact:true})).toHaveValue('');
  await expect(page.getByRole('combobox',{name:'Subscriber plan',exact:true})).toHaveValue('');
  await page.screenshot({path:'../output/qa/ocr76-order-recapture.png'});
});
