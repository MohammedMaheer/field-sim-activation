import { expect, test } from '@playwright/test';
import { authenticate } from './session';

test('agent SIM scan and saved draft reach the administrator and agent web views', async ({page, browser, request}) => {
  test.setTimeout(120000);
  const login = await request.post('/api/auth/login', {data:{email:'agent1@relay.demo',password:process.env.DEMO_PASSWORD,native:true}});
  expect(login.ok()).toBeTruthy();
  const agent = await login.json();
  const headers = {Authorization:`Bearer ${agent.access_token}`};
  const inventoryResponse = await request.get('/api/resources/inventory',{headers});
  expect(inventoryResponse.ok()).toBeTruthy();
  const stock = (await inventoryResponse.json()).find((row:{status:string;agent_id:string;scan_transaction_id?:string}) => row.status === 'AVAILABLE' && row.agent_id === agent.user.agent_id && !row.scan_transaction_id);
  expect(stock, 'An assigned available synthetic SIM is needed for this connection check').toBeTruthy();
  const transactionId = crypto.randomUUID();
  const draftName = `Connection check ${transactionId.slice(0,8)}`;
  let draftId = '';
  const agentContext = await browser.newContext();
  try {
    const scan = await request.post('/api/inventory/scan',{headers,data:{code:stock.iccid,transaction_id:transactionId}});
    expect(scan.ok(), await scan.text()).toBeTruthy();
    const saved = await request.post('/api/kyc-captures/saved-drafts',{headers,data:{data:{transaction_id:transactionId,name:draftName,sim_identifier:stock.iccid,step:0}}});
    expect(saved.ok(), await saved.text()).toBeTruthy();
    draftId = (await saved.json()).id;

    await authenticate(page);
    await page.goto(`/inventory?selected=${stock.id}`);
    const simDetails = page.getByRole('dialog',{name:'SIM balance & history'});
    await expect(simDetails).toContainText('IN PROGRESS');
    await expect(simDetails).toContainText('NOT UPLOADED');
    await page.waitForTimeout(450);
    await page.screenshot({path:'../output/qa/connected-sim-admin.png'});

    const agentPage = await agentContext.newPage();
    await agentPage.goto('/', {waitUntil:'domcontentloaded'});
    await agentPage.locator('input[type=email]').fill('agent1@relay.demo');
    await agentPage.locator('input[type=password]').fill(process.env.DEMO_PASSWORD!);
    await agentPage.getByRole('button',{name:'Sign in to workspace'}).click();
    await expect(agentPage.locator('input[type=password]')).toBeHidden();
    await agentPage.goto('/kyc-capture');
    await agentPage.getByRole('button',{name:'Drafts',exact:true}).click();
    await expect(agentPage.getByRole('dialog',{name:'Drafts'})).toContainText(draftName);
    await agentPage.waitForTimeout(450);
    await agentPage.screenshot({path:'../output/qa/connected-agent-draft.png'});
  } finally {
    if (draftId) await request.delete(`/api/kyc-captures/saved-drafts/${draftId}`,{headers});
    else await request.delete(`/api/inventory/scan/${transactionId}`,{headers});
    await agentContext.close();
  }
});
