import { test, expect, Page, APIRequestContext } from "@playwright/test";
import { businessDate } from "../src/businessTime";

// These checks can create disposable records and must use an isolated QA database.
test.beforeEach(() =>
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1",
    "Isolated QA database only",
  ),
);
async function signIn(page: Page, email = "admin@relay.demo") {
  await page.goto("/");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Operations overview/ }),
  ).toBeVisible();
}
async function apiHeaders(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: {
      email: "admin@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}
async function fits(page: Page) {
  if (await page.locator(".sidebar.open").count())
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("real portal keeps admin review and Operations Manager capture separated", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto("/kyc-capture");
  await expect(
    page.getByRole("button", { name: "New transaction capture", exact: true }),
  ).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("link", { name: "Notifications", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Manage workspace", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  const other = await browser.newContext();
  const ops = await other.newPage();
  await signIn(ops, "ops@relay.demo");
  await ops.goto("/kyc-capture");
  await expect(
    ops.getByRole("button", { name: "New transaction capture", exact: true }),
  ).toBeVisible();
  await ops
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(
    ops
      .getByRole("heading", { name: /Customer details|New transaction/ })
      .first(),
  ).toBeVisible();
  await fits(ops);
  await ops.screenshot({
    path: "../output/qa/latest-real-ops-capture.png",
    animations: "disabled",
  });
  await other.close();
});

test("real branch controls edit multiple leaders and all product targets", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const headers = await apiHeaders(request),
    suffix = Date.now();
  const create = async (kind: string, data: any) => {
    const response = await request.post(`/api/organization/${kind}`, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const branch = await create("branches", { name: `QA leaders ${suffix}` });
  const leaderA = await create("teams", {
    name: `QA first leader ${suffix}`,
    email: `qa.first.${suffix}@relay.demo`,
    password: "Only-QA-Pass!2026",
    branch_id: branch.id,
  });
  const leaderB = await create("teams", {
    name: `QA second leader ${suffix}`,
    email: `qa.second.${suffix}@relay.demo`,
    password: "Only-QA-Pass!2026",
    branch_id: branch.id,
  });
  const agent = await create("agents", {
    name: `QA sales agent ${suffix}`,
    email: `qa.sales.${suffix}@relay.demo`,
    password: "Only-QA-Pass!2026",
    employee_id: `QA-${suffix}`,
    branch_id: branch.id,
    leader_id: leaderA.id,
    target: 20,
  });
  await signIn(page);
  await page.goto(`/branches?selected=${branch.id}`);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("checkbox", { name: new RegExp(leaderA.name) }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: new RegExp(leaderB.name) }),
  ).toBeChecked();
  await dialog
    .getByRole("checkbox", { name: new RegExp(leaderB.name) })
    .uncheck();
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Isolated QA explicit leader unassignment");
  await dialog
    .getByRole("button", { name: "Save team leaders", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `/api/organization/branches/${branch.id}/leaders`,
              { headers },
            )
          ).json()
        ).leaders.length,
    )
    .toBe(1);
  await page.keyboard.press("Escape");
  await page.goto("/team-leaders");
  // The unassigned leader can be edited from the management section after reassignment.
  const response = await request.put(
    `/api/organization/branches/${branch.id}/leaders`,
    {
      headers,
      data: {
        leader_ids: [leaderA.id, leaderB.id],
        expected_leader_ids: [leaderA.id],
        reason: "Isolated QA restore both selected leaders",
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.reload();
  await page
    .locator(".leader-card")
    .filter({
      has: page.getByRole("heading", { name: leaderB.name, exact: true }),
    })
    .getByRole("button", { name: "Edit team leader", exact: true })
    .click();
  await dialog
    .getByLabel("Team leader name", { exact: true })
    .fill(`QA updated leader ${suffix}`);
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Isolated QA team leader profile update");
  await dialog
    .getByRole("button", { name: "Save team leader", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `QA updated leader ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/sales?tab=targets&agent=${agent.id}`);
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption(branch.id);
  for (const name of [
    "New postpaid",
    "MNP",
    "Prepaid to postpaid",
    "Home Wireless",
    "eLife",
    "Wasel / Prepaid",
    "Visitor",
  ])
    await expect(
      page.getByLabel(`${name} daily target`, { exact: true }),
    ).toHaveValue("");
  await page
    .getByLabel("Home Wireless daily target", { exact: true })
    .fill("2");
  await page
    .getByLabel("Home Wireless monthly target", { exact: true })
    .fill("60");
  await page
    .locator("tr")
    .filter({ has: page.getByText("Home Wireless", { exact: true }) })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `/api/sales-management/targets?branch_id=${branch.id}`,
              { headers },
            )
          ).json()
        ).find(
          (row: any) => row.agent_id === agent.id && row.order_type === "HW",
        )?.monthly_target,
    )
    .toBe(60);
  await fits(page);
  await page.screenshot({
    path: "../output/qa/latest-real-product-targets.png",
    animations: "disabled",
  });
});

test("real branch context follows modules and reports start today", async ({
  page,
  request,
}) => {
  const headers = await apiHeaders(request),
    branches = await (
      await request.get("/api/resources/branches", { headers })
    ).json();
  const selected = branches[0];
  expect(selected).toBeTruthy();
  await signIn(page);
  await page.goto("/agents");
  const branch = page.locator(".topbar").getByRole("combobox", {
    name: "Branch",
    exact: true,
  });
  await branch.selectOption(selected.id);
  for (const path of [
    "/inventory",
    "/sales?tab=feedback",
    "/equipment",
    "/call-work",
    "/incentives",
    "/support",
    "/reports",
  ]) {
    await page.goto(path);
    await expect(branch).toHaveValue(selected.id);
    await expect(
      page.getByText("Something went wrong", { exact: true }),
    ).toHaveCount(0);
    await fits(page);
  }
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    businessDate(),
  );
  await expect(page.getByLabel("To date", { exact: true })).toHaveValue(
    businessDate(),
  );
  await page.getByLabel("From date", { exact: true }).fill("2026-10-01");
  const download = page.waitForEvent("download");
  await page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "SIM inventory", exact: true }),
    })
    .getByRole("button", { name: "CSV", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.reload();
  await expect(branch).toHaveValue(selected.id);
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    businessDate(),
  );
  await page.screenshot({
    path: "../output/qa/latest-real-reports-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({
    path: "../output/qa/latest-real-reports-mobile.png",
    animations: "disabled",
  });
});

test("real customer records show authorized SR and sale history", async ({
  page,
  request,
}) => {
  const headers = await apiHeaders(request),
    response = await request.get("/api/resources/customers", { headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  const customers = await response.json(),
    customer = customers.find((row: any) => row.sales?.length);
  expect(
    customer,
    "QA dataset should contain a linked customer sale",
  ).toBeTruthy();
  await signIn(page);
  await page.goto("/customers");
  await page
    .getByRole("button", { name: `View ${customer.name}`, exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: customer.name, exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('[data-field="sr_number"] dd')).toHaveText(
    customer.sr_number || "Not recorded",
  );
  const sale = customer.sales[0];
  await expect(
    dialog
      .getByRole("link", {
        name: sale.request_id || "Not recorded",
        exact: true,
      })
      .first(),
  ).toHaveAttribute("href", `/sales?selected=${encodeURIComponent(sale.id)}`);
  await expect(
    dialog.getByText(sale.activation_label, { exact: true }).first(),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    path: "../output/qa/latest-real-customer-history.png",
    animations: "disabled",
  });
});
