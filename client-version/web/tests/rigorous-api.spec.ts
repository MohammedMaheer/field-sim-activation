import {test,expect,APIRequestContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';

type Auth={headers:Record<string,string>;user:any;refresh:string};
const sessions=new Map<string,Auth>();
async function auth(request:APIRequestContext,account='admin'):Promise<Auth>{
  if(sessions.has(account))return sessions.get(account)!;
  const response=await request.post('/api/auth/login',{data:{email:`${account}@relay.demo`,password:process.env.DEMO_PASSWORD,native:true}});
  expect(response.status(),await response.text()).toBe(200);
  const body=await response.json();const value={headers:{Authorization:`Bearer ${body.access_token}`},user:body.user,refresh:body.refresh_token};
  sessions.set(account,value);return value;
}
test.beforeEach(async({request,baseURL})=>{
  test.skip(!process.env.RELAY_RIGOROUS_MUTATION_TEST,'Fresh isolated PostgreSQL dataset required');
  expect(baseURL).toBe('http://127.0.0.1:5191');
  expect((await(await request.get('/api/health')).json()).database).toBe('postgresql');
});

test('dashboard work counts reconcile and branch filters never broaden access',async({request})=>{
  const {headers}=await auth(request);
  const dashboard=await (await request.get('/api/dashboard',{headers})).json();
  const sales=await (await request.get('/api/sales-management/sales',{headers})).json();
  const calls=await (await request.get('/api/sales-management/call-tasks',{headers})).json();
  expect(dashboard.recent_sales.map((r:any)=>r.id)).toEqual(sales.slice(0,6).map((r:any)=>r.id));
  expect(dashboard.sales_plan_mix.reduce((sum:number,r:any)=>sum+r.value,0)).toBe(sales.filter((r:any)=>r.status==='CLOSED').length);
  expect(dashboard.branches.reduce((sum:number,r:any)=>sum+r.closed_sales,0)).toBe(sales.filter((r:any)=>r.status==='CLOSED').length);
  const stock=await (await request.get('/api/field-assets/requests/list',{headers})).json();
  const support=await (await request.get('/api/support-tickets',{headers})).json();
  expect(dashboard.work_summary).toEqual({
    open_sales:sales.filter((r:any)=>r.status==='IN_PROGRESS').length,
    ready_calls:calls.filter((r:any)=>['PENDING','FAILED'].includes(r.status)).length,
    stock_requests:stock.filter((r:any)=>r.status==='REQUESTED').length,
    open_support:support.filter((r:any)=>r.status!=='RESOLVED').length,
  });
  const total={open_sales:0,ready_calls:0,stock_requests:0,open_support:0};
  for(const branch of dashboard.branches){
    const scoped=await (await request.get(`/api/dashboard?branch_id=${branch.id}`,{headers})).json();
    for(const key of Object.keys(total) as (keyof typeof total)[])total[key]+=scoped.work_summary[key];
  }
  expect(total).toEqual(dashboard.work_summary);
  const agent=await auth(request,'agent1');
  const foreign=await(await request.get('/api/dashboard?branch_id=not-authorized',{headers:agent.headers})).json();
  expect(foreign.work_summary).toEqual({open_sales:0,ready_calls:0,stock_requests:0,open_support:0});
});

test('anonymous requests and revoked sessions cannot reach private records',async({request})=>{
  for(const route of ['/api/dashboard','/api/resources/agents','/api/kyc-captures','/api/support-tickets','/api/field-assets','/api/sales-management/sales']){
    expect((await request.get(route,{headers:{Authorization:'Bearer invalid'}})).status(),route).toBe(401);
  }
  const response=await request.post('/api/auth/login',{data:{email:'agent2@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  const body=await response.json(),headers={Authorization:`Bearer ${body.access_token}`};
  expect((await request.post('/api/auth/logout',{headers})).ok()).toBeTruthy();
  expect((await request.get('/api/auth/me',{headers})).status()).toBe(401);
  expect((await request.post('/api/auth/refresh',{data:{refresh_token:body.refresh_token,native:true}})).status()).toBe(401);
});

for(const account of ['admin','ops','leader','leader2','cluster','compliance','inventory','salesmanager','agent1','tele','welcome']){
  test(`${account} has consistent scoped API visibility`,async({request})=>{
    const {headers,user}=await auth(request,account);
    const isCall=['tele','welcome'].includes(account);
    for(const route of ['/api/dashboard','/api/resources/agents','/api/resources/inventory','/api/support-tickets','/api/field-assets','/api/sales-management/sales']){
      const response=await request.get(route,{headers});
      expect(response.status(),route+': '+await response.text()).toBe(isCall?403:200);
    }
    if(!isCall){
      const agents=await(await request.get('/api/resources/agents',{headers})).json();
      if(account==='agent1')expect(agents.map((row:any)=>row.id)).toEqual([user.agent_id]);
      if(['leader','leader2','cluster','salesmanager'].includes(account))expect(agents.every((row:any)=>row.branch===(account==='leader2'?'Abu Dhabi Region':'Dubai Central'))).toBeTruthy();
      const outside=await(await request.get('/api/resources/agents?branch_id=not-authorized',{headers})).json();expect(outside).toEqual([]);
      const inventory=await(await request.get('/api/resources/inventory',{headers})).json();
      for(const sim of inventory)expect(sim).not.toHaveProperty('lat');
    }
    expect((await request.get('/api/sales-management/staff',{headers})).status()).toBe(['admin','ops'].includes(account)?200:403);
    if(!['admin','ops','compliance'].includes(account))expect((await request.post('/api/kyc-captures/no-such-capture/review',{headers,data:{version:1,outcome:'VERIFIED',reason:'Unauthorized review attempt'}})).status()).toBe(403);
  });
}

test('agent support reaches staff, resolution reaches agent and cannot be overwritten',async({request})=>{
  const agent=await auth(request,'agent1'),admin=await auth(request),other=await auth(request,'agent4');
  const title=`Rigorous support ${Date.now()}`;
  expect((await request.post('/api/support-tickets',{headers:agent.headers,data:{agent_id:agent.user.agent_id,subject:'  ',message:'  incomplete  '}})).status()).toBe(422);
  const created=await request.post('/api/support-tickets',{headers:agent.headers,data:{agent_id:agent.user.agent_id,subject:title,message:'The stock request needs a branch response.'}});
  expect(created.status(),await created.text()).toBe(201);const ticket=await created.json();
  expect((await(await request.get('/api/support-tickets',{headers:other.headers})).json()).some((row:any)=>row.id===ticket.id)).toBeFalsy();
  expect((await request.patch(`/api/support-tickets/${ticket.id}`,{headers:agent.headers,data:{status:'RESOLVED',response:'Agent cannot resolve own request'}})).status()).toBe(403);
  const resolved=await request.patch(`/api/support-tickets/${ticket.id}`,{headers:admin.headers,data:{status:'RESOLVED',response:'Branch stock has been checked and confirmed.'}});
  expect(resolved.status(),await resolved.text()).toBe(200);
  const returned=(await(await request.get('/api/support-tickets',{headers:agent.headers})).json()).find((row:any)=>row.id===ticket.id);
  expect(returned.status).toBe('RESOLVED');expect(returned.response).toContain('confirmed');
  expect((await request.patch(`/api/support-tickets/${ticket.id}`,{headers:admin.headers,data:{status:'IN_PROGRESS',response:'Do not overwrite a resolved ticket'}})).status()).toBe(409);
});

test('blank labels, blank reasons and oversized encoded passwords are rejected cleanly',async({request})=>{
  const admin=await auth(request),agent=await auth(request,'agent1');
  const branch_id=(await(await request.get('/api/resources/agents',{headers:agent.headers})).json())[0].branch_id;
  const cases:[string,Record<string,unknown>,Record<string,string>][]=[
    ['/api/support-tickets',{agent_id:agent.user.agent_id,subject:'   ',message:'            '},agent.headers],
    ['/api/field-assets',{category:'UNIFORM',label:'   ',quantity:1,branch_id},admin.headers],
    ['/api/field-assets/requests',{agent_id:agent.user.agent_id,category:'UNIFORM',quantity:1,reason:'      '},agent.headers],
    ['/api/sales-management/staff',{name:'   ',email:`blank-${Date.now()}@relay.demo`,password:'valid-test-password',role:'Sales Manager',branch_id},admin.headers],
    ['/api/sales-management/staff',{name:'Password audit',email:`bytes-${Date.now()}@relay.demo`,password:'🔐'.repeat(30),role:'Sales Manager',branch_id},admin.headers],
  ];
  for(const [route,data,headers] of cases){const response=await request.post(route,{headers,data});expect(response.status(),route+': '+await response.text()).toBe(422);}
});

test('bulk stock balances, urgency, fulfilment and shortage alerts reconcile across roles',async({request})=>{
  const admin=await auth(request),agent=await auth(request,'agent1'),other=await auth(request,'agent4');
  const branch_id=(await(await request.get('/api/resources/agents',{headers:agent.headers})).json())[0].branch_id;const category=`QA_SUPPLY_${Date.now()}`;
  const created=await request.post('/api/field-assets',{headers:admin.headers,data:{category,label:'Audit uniform batch',quantity:10,branch_id,warehouse:'QA warehouse',batch:`AUDIT-${Date.now()}`,size:'M',condition:'New'}});
  expect(created.status(),await created.text()).toBe(201);const stock=await created.json();
  expect((await request.post(`/api/field-assets/${stock.id}/issue`,{headers:admin.headers,data:{quantity:11,agent_id:agent.user.agent_id,reason:'Excess issue must be rejected'}})).status()).toBe(409);
  expect((await request.post(`/api/field-assets/${stock.id}/issue`,{headers:admin.headers,data:{quantity:1,agent_id:other.user.agent_id,reason:'Cross branch must be rejected'}})).status()).toBe(422);
  const issued=await request.post(`/api/field-assets/${stock.id}/issue`,{headers:admin.headers,data:{quantity:3,agent_id:agent.user.agent_id,reason:'Issue required uniforms'}});
  expect(issued.status(),await issued.text()).toBe(201);const allocated=await issued.json();
  const requested=await request.post('/api/field-assets/requests',{headers:agent.headers,data:{agent_id:agent.user.agent_id,category,quantity:3,urgency:'URGENT',reason:'Required for the next shift'}});
  expect(requested.status(),await requested.text()).toBe(201);const id=(await requested.json()).id;
  expect((await request.patch(`/api/field-assets/requests/${id}`,{headers:admin.headers,data:{status:'FULFILLED',asset_id:allocated.id,reason:'Premature fulfilment rejected'}})).status()).toBe(409);
  expect((await request.patch(`/api/field-assets/requests/${id}`,{headers:admin.headers,data:{status:'APPROVED',reason:'Stock available for issue'}})).status()).toBe(200);
  expect((await request.patch(`/api/field-assets/requests/${id}`,{headers:admin.headers,data:{status:'FULFILLED',asset_id:allocated.id,reason:'Matched issued uniforms'}})).status()).toBe(200);
  expect((await request.put('/api/field-assets/report/threshold',{headers:admin.headers,data:{branch_id,category,minimum:8}})).status()).toBe(200);
  const balance=(await(await request.get('/api/field-assets/report/summary',{headers:admin.headers})).json()).find((row:any)=>row.branch_id===branch_id&&row.category===category);
  expect(balance.available).toBe(7);expect(balance.assigned).toBe(3);expect(balance.low_stock).toBeTruthy();
  const seen=(await(await request.get('/api/field-assets/requests/list',{headers:agent.headers})).json()).find((row:any)=>row.id===id);
  expect(seen.status).toBe('FULFILLED');expect(seen.urgency).toBe('URGENT');
  expect((await(await request.get('/api/field-assets',{headers:other.headers})).json()).some((row:any)=>row.id===allocated.id)).toBeFalsy();
  const exportFile=await request.get(`/api/field-assets/report/export?kind=stock&format=xlsx&category=${category}`,{headers:admin.headers});
  expect(exportFile.ok()).toBeTruthy();expect((await exportFile.body()).subarray(0,2).toString()).toBe('PK');
  expect((await request.post(`/api/field-assets/${stock.id}/adjust`,{headers:admin.headers,data:{delta:-8,reason:'Negative balance rejected'}})).status()).toBe(422);
  expect((await request.post(`/api/field-assets/${stock.id}/adjust`,{headers:agent.headers,data:{delta:1,reason:'Agent cannot adjust stock'}})).status()).toBe(403);
});

test('status imports preserve atomicity and cancelled sales leave actionable call queues',async({request})=>{
  const admin=await auth(request),agent=await auth(request,'agent1'),tele=await auth(request,'tele');
  const created=await request.post('/api/sales-management/sales',{headers:admin.headers,data:{agent_id:agent.user.agent_id,order_type:'MNP',customer_name:'Audit order',plan_name:'Flexi Postpaid',request_id:`AUDIT-${Date.now()}`}});
  expect(created.status(),await created.text()).toBe(201);const sale=await created.json();
  const encoded=(rows:string)=>Buffer.from('sale_id,current_status,new_status\n'+rows).toString('base64');
  const invalid={filename:'audit.csv',apply:true,content_base64:encoded(`${sale.id},IN_PROGRESS,CLOSED\nmissing,IN_PROGRESS,CLOSED\n`)};
  expect((await request.post('/api/sales-management/status-file',{headers:admin.headers,data:invalid})).status()).toBe(422);
  expect((await(await request.get('/api/sales-management/sales',{headers:admin.headers})).json()).find((row:any)=>row.id===sale.id).status).toBe('IN_PROGRESS');
  const content_base64=encoded(`${sale.id},IN_PROGRESS,CANCELLED\n`);
  const preview=await request.post('/api/sales-management/status-file',{headers:admin.headers,data:{filename:'audit.csv',content_base64,apply:false}});expect(preview.ok()).toBeTruthy();expect((await preview.json()).applied).toBeFalsy();
  expect((await request.post('/api/sales-management/status-file',{headers:admin.headers,data:{filename:'audit.csv',content_base64,apply:true}})).status()).toBe(200);
  const task=(await(await request.get('/api/sales-management/call-tasks',{headers:tele.headers})).json()).find((row:any)=>row.sale_id===sale.id);
  expect(task.status).toBe('CANCELLED');
  expect((await request.post(`/api/sales-management/sales/${sale.id}/calls`,{headers:tele.headers,data:{stage:'TELE_VERIFICATION',outcome:'PASSED',remark:'Cancelled sale cannot be called'}})).status()).toBe(409);
  expect((await request.post('/api/sales-management/status-file',{headers:admin.headers,data:{filename:'audit.csv',content_base64,apply:true}})).status()).toBe(422);
});

test('simultaneous stock operations cannot over-issue or fulfil two requests with one allocation',async({request})=>{
  const admin=await auth(request),agent=await auth(request,'agent1');
  const branch_id=(await(await request.get('/api/resources/agents',{headers:agent.headers})).json())[0].branch_id;
  const category=`RACE_SUPPLY_${Date.now()}`;
  const stock=await(await request.post('/api/field-assets',{headers:admin.headers,data:{category,label:'Concurrent issue check',quantity:5,branch_id}})).json();
  const issue=()=>request.post(`/api/field-assets/${stock.id}/issue`,{headers:admin.headers,data:{quantity:3,agent_id:agent.user.agent_id,reason:'Simultaneous issue check'}});
  const results=await Promise.all([issue(),issue()]);
  expect(results.map(result=>result.status()).sort()).toEqual([201,409]);
  const allocation=await results.find(result=>result.status()===201)!.json();
  const requests=[];
  for(let i=0;i<2;i++){
    const created=await request.post('/api/field-assets/requests',{headers:agent.headers,data:{agent_id:agent.user.agent_id,category,quantity:3,reason:'Concurrent fulfilment check'}});
    expect(created.status()).toBe(201);const row=await created.json();requests.push(row.id);
    expect((await request.patch(`/api/field-assets/requests/${row.id}`,{headers:admin.headers,data:{status:'APPROVED',reason:'Approved isolated audit'}})).status()).toBe(200);
  }
  const outcomes=await Promise.all(requests.map(id=>request.patch(`/api/field-assets/requests/${id}`,{headers:admin.headers,data:{status:'FULFILLED',asset_id:allocation.id,reason:'One allocation cannot be counted twice'}})));
  expect(outcomes.map(response=>response.status()).sort()).toEqual([200,409]);
  const balances=await(await request.get('/api/field-assets/report/summary',{headers:admin.headers})).json();
  const balance=balances.find((row:any)=>row.branch_id===branch_id&&row.category===category);expect(balance.available).toBe(2);expect(balance.assigned).toBe(3);
});

test('real server extraction binds both images and rejects missing or replaced evidence',async({request})=>{
  test.setTimeout(120000);
  const agent=await auth(request,'agent1');
  const image=async(name:string)=>(await readFile(`../mobile/assets/demo/${name}.png`)).toString('base64');
  const document_image=await image('identity'),order_image=await image('order'),confirmation=await image('payment');
  const invalid=await request.post('/api/kyc-captures/read-document',{headers:agent.headers,data:{image_base64:'not an image'}});expect(invalid.status()).toBe(422);
  const document=await request.post('/api/kyc-captures/read-document',{headers:agent.headers,data:{image_base64:document_image}});expect(document.status(),await document.text()).toBe(200);const identity=await document.json();expect(identity.document_check).toBeTruthy();
  const order=await request.post('/api/kyc-captures/read-order',{headers:agent.headers,data:{image_base64:order_image}});expect(order.status(),await order.text()).toBe(200);const details=await order.json();expect(details.order_check).toBeTruthy();
  const plans=await(await request.get('/api/resources/plans',{headers:agent.headers})).json();
  const intake={...identity,...details,document_image,order_image,plan_id:details.plan_id||plans[0].id,capture_mode:'SCREENSHOT_ORDER'};
  const data={document_kind:'PAYMENT_CONFIRMATION',agent_id:agent.user.agent_id,operation_id:crypto.randomUUID(),image_base64:confirmation,intake,source_reference:`AUDIT-EVIDENCE-${Date.now()}`};
  expect((await request.post('/api/kyc-captures',{headers:agent.headers,data:{...data,intake:{...intake,document_image:order_image}}})).status()).toBe(422);
  expect((await request.post('/api/kyc-captures',{headers:agent.headers,data:{...data,intake:{...intake,document_check:''}}})).status()).toBe(422);
  const capture=await request.post('/api/kyc-captures',{headers:agent.headers,data});expect(capture.status(),await capture.text()).toBe(201);const saved=await capture.json();
  const retry=await request.post('/api/kyc-captures',{headers:agent.headers,data});expect((await retry.json()).id).toBe(saved.id);
  expect((await request.post('/api/kyc-captures',{headers:agent.headers,data:{...data,source_reference:'Different reference'}})).status()).toBe(409);
  const other=await auth(request,'agent4');expect((await request.get(`/api/kyc-captures/${saved.id}`,{headers:other.headers})).status()).toBe(404);
});

test('an ordinary image cannot become customer or order capture evidence',async({request,page})=>{
  const agent=await auth(request,'agent1');
  const image_base64=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
    const context=canvas.getContext('2d')!;context.fillStyle='#f4f0e6';context.fillRect(0,0,640,400);
    context.fillStyle='#287ed6';context.beginPath();context.arc(320,200,110,0,Math.PI*2);context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  for(const route of ['read-document','read-order']){
    const response=await request.post(`/api/kyc-captures/${route}`,{headers:agent.headers,data:{image_base64}});
    expect(response.status(),await response.text()).toBe(422);
    const result=await response.json();expect(result.detail).toMatch(/captured|read|clear/i);
  }
});
