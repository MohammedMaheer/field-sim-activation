import { expect, APIRequestContext, Page, test } from "@playwright/test";

test.beforeEach(() => {
  const url = new URL(process.env.RELAY_WEB_URL || "http://localhost:5174");
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["localhost", "127.0.0.1"].includes(url.hostname),
    "Writes only to an explicitly enabled disposable local database",
  );
});

async function signIn(page: Page, email = "admin@relay.demo") {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Work email", exact: true })
    .fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Operations overview/ }),
  ).toBeVisible();
}
async function access(
  request: APIRequestContext,
  email: string,
  password = process.env.DEMO_PASSWORD!,
) {
  const response = await request.post("/api/auth/login", {
    data: { email, password, native: true },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}
async function saveCreation(page: Page, kind: string, button: string) {
  const waiting = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/organization/${kind}` &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: button, exact: true })
    .click();
  const response = await waiting;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("actual browser branch setup and reassignment preserve original sales and access", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const suffix = Date.now(),
    password = "Isolated-QA-Pass!2026";
  await signIn(page);
  const managementHeaders = await access(request, "admin@relay.demo");
  await page.goto("/branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Edit branch team leaders", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Branch name", { exact: true })
    .fill(`Garden Branch ${suffix}`);
  const firstBranch = await saveCreation(page, "branches", "Create branch");
  await expect(
    dialog.getByRole("combobox", { name: "Branch", exact: true }),
  ).toHaveValue(firstBranch.id);
  await dialog
    .getByLabel("Team leader name", { exact: true })
    .fill(`Garden Leader ${suffix}`);
  await dialog
    .getByLabel("Sign-in email", { exact: true })
    .fill(`qa.leader.first.${suffix}@example.test`);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  const firstLeader = await saveCreation(page, "teams", "Create team leader");
  await expect(
    dialog.getByRole("combobox", {
      name: "Reporting team leader",
      exact: true,
    }),
  ).toHaveValue(firstLeader.id);
  await dialog
    .getByLabel("Sales agent name", { exact: true })
    .fill(`Garden Sales Agent ${suffix}`);
  await dialog.getByLabel("Employee ID", { exact: true }).fill(`QA-${suffix}`);
  await dialog
    .getByLabel("Sign-in email", { exact: true })
    .fill(`qa.agent.${suffix}@example.test`);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  const salesAgent = await saveCreation(page, "agents", "Create sales agent");
  await expect(dialog.getByRole("status")).toContainText("Sales agent created");
  await page.keyboard.press("Escape");

  await page.goto("/team-leaders");
  await page
    .getByRole("button", { name: "Add team leader", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption(firstBranch.id);
  await dialog
    .getByLabel("Team leader name", { exact: true })
    .fill(`Additional Garden Leader ${suffix}`);
  await dialog
    .getByLabel("Sign-in email", { exact: true })
    .fill(`qa.leader.additional.${suffix}@example.test`);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  const extraLeader = await saveCreation(page, "teams", "Create team leader");
  await page.keyboard.press("Escape");
  let agent = (
    await (
      await request.get(`/api/agents/${salesAgent.id}/management`, {
        headers: managementHeaders,
      })
    ).json()
  ).agent;
  expect(agent.leader_id).toBe(firstLeader.id);

  const agentHeaders = await access(
    request,
    `qa.agent.${suffix}@example.test`,
    password,
  );
  const oldResponse = await request.post("/api/sales-management/sales", {
    headers: agentHeaders,
    data: {
      agent_id: salesAgent.id,
      order_type: "WASEL",
      customer_name: `Synthetic Customer ${suffix}`,
      plan_name: "Tourist Prepaid",
      request_id: `QA-OLD-${suffix}`,
      sr_number: `QA-SR-OLD-${suffix}`,
    },
  });
  expect(oldResponse.ok(), await oldResponse.text()).toBe(true);
  const oldSale = await oldResponse.json();
  expect(oldSale.leader_id).toBe(firstLeader.id);
  expect(oldSale.branch_id).toBe(firstBranch.id);

  await page.goto("/agents");
  await page
    .getByRole("button", {
      name: `View Garden Sales Agent ${suffix}`,
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Change branch or team leader", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Reporting team leader", exact: true })
    .selectOption(extraLeader.id);
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Approved reporting leader reassignment");
  await dialog
    .getByRole("button", { name: "Review assignment changes", exact: true })
    .click();
  agent = (
    await (
      await request.get(`/api/agents/${salesAgent.id}/management`, {
        headers: managementHeaders,
      })
    ).json()
  ).agent;
  expect(agent.leader_id).toBe(firstLeader.id);
  await expect(
    dialog.getByRole("region", { name: "Review sales agent assignment" }),
  ).toContainText(
    `Garden Leader ${suffix} → Additional Garden Leader ${suffix}`,
  );
  await dialog
    .getByRole("button", { name: "Confirm assignment changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  agent = (
    await (
      await request.get(`/api/agents/${salesAgent.id}/management`, {
        headers: managementHeaders,
      })
    ).json()
  ).agent;
  expect(agent.leader_id).toBe(extraLeader.id);
  expect(agent.branch_id).toBe(firstBranch.id);
  const original = await request.get(
    `/api/sales-management/sales/${oldSale.id}`,
    { headers: managementHeaders },
  );
  expect((await original.json()).leader_id).toBe(firstLeader.id);

  await page.goto("/branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Branch name", { exact: true })
    .fill(`Harbour Branch ${suffix}`);
  const nextBranch = await saveCreation(page, "branches", "Create branch");
  await dialog
    .getByLabel("Team leader name", { exact: true })
    .fill(`Harbour Leader ${suffix}`);
  await dialog
    .getByLabel("Sign-in email", { exact: true })
    .fill(`qa.leader.next.${suffix}@example.test`);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  const nextLeader = await saveCreation(page, "teams", "Create team leader");
  await page.keyboard.press("Escape");
  await page.goto(`/agents?selected=${salesAgent.id}`);
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Change branch or team leader", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Assigned branch", exact: true })
    .selectOption(nextBranch.id);
  await expect(
    dialog.getByRole("combobox", {
      name: "Reporting team leader",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(
    dialog
      .getByRole("combobox", { name: "Reporting team leader", exact: true })
      .locator("option"),
  ).toHaveText(["Select team leader", `Harbour Leader ${suffix}`]);
  await dialog
    .getByRole("combobox", { name: "Reporting team leader", exact: true })
    .selectOption(nextLeader.id);
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Approved move to Harbour Branch");
  await dialog
    .getByRole("button", { name: "Review assignment changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm assignment changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  const newAgentHeaders = await access(
    request,
    `qa.agent.${suffix}@example.test`,
    password,
  );
  const newResponse = await request.post("/api/sales-management/sales", {
    headers: newAgentHeaders,
    data: {
      agent_id: salesAgent.id,
      order_type: "WASEL",
      customer_name: `Synthetic New Customer ${suffix}`,
      plan_name: "Tourist Prepaid",
      request_id: `QA-NEW-${suffix}`,
    },
  });
  expect(newResponse.ok(), await newResponse.text()).toBe(true);
  const newSale = await newResponse.json();
  expect(newSale.branch_id).toBe(nextBranch.id);
  expect(newSale.leader_id).toBe(nextLeader.id);
  const retained = await request.get(
    `/api/sales-management/sales/${oldSale.id}`,
    { headers: newAgentHeaders },
  );
  expect(retained.ok(), await retained.text()).toBe(true);
  expect((await retained.json()).branch_id).toBe(firstBranch.id);
  const firstLeaderHeaders = await access(
    request,
    `qa.leader.first.${suffix}@example.test`,
    password,
  );
  expect(
    (
      await request.get(`/api/sales-management/sales/${oldSale.id}`, {
        headers: firstLeaderHeaders,
      })
    ).status(),
  ).toBe(200);
  const nextLeaderHeaders = await access(
    request,
    `qa.leader.next.${suffix}@example.test`,
    password,
  );
  expect(
    (
      await request.get(`/api/sales-management/sales/${oldSale.id}`, {
        headers: nextLeaderHeaders,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(`/api/sales-management/sales/${newSale.id}`, {
        headers: nextLeaderHeaders,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.patch(`/api/agents/${salesAgent.id}/management`, {
        headers: nextLeaderHeaders,
        data: {
          target: 20,
          outlet_id: agent.outlet_id,
          leader_id: firstLeader.id,
          expected_target: 20,
          expected_outlet_id: agent.outlet_id,
          expected_leader_id: extraLeader.id,
          reason: "Unauthorized self assignment",
        },
      })
    ).status(),
  ).toBe(403);
  const readonly = await page.context().browser()!.newContext();
  const leaderPage = await readonly.newPage();
  await leaderPage.goto("/");
  await leaderPage
    .getByRole("textbox", { name: "Work email", exact: true })
    .fill(`qa.leader.next.${suffix}@example.test`);
  await leaderPage.getByLabel("Password", { exact: true }).fill(password);
  await leaderPage
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    leaderPage.getByRole("heading", { name: /^Operations overview/ }),
  ).toBeVisible();
  await leaderPage.goto("/team-leaders");
  await expect(
    leaderPage.getByRole("button", { name: "Add team leader", exact: true }),
  ).toHaveCount(0);
  await expect(
    leaderPage.getByRole("button", { name: "Change branch", exact: true }),
  ).toHaveCount(0);
  await readonly.close();
  await page.goto(`/agents?selected=${salesAgent.id}`);
  await expect(page.getByRole("dialog")).toContainText(
    `Harbour Branch ${suffix}`,
  );
  await page.screenshot({
    path: "../output/qa/leader-usability-connected-agent-final.png",
    animations: "disabled",
  });
});
