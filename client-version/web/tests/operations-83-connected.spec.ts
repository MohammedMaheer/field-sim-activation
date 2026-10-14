import { APIRequestContext, expect, Page, test } from "@playwright/test";
import { businessDate } from "../src/businessTime";

// These create only synthetic records in the explicitly selected, disposable API.
test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["localhost", "127.0.0.1"].includes(
        new URL(baseURL || "http://invalid").hostname,
      ),
    "Requires the explicitly opted-in isolated QA database",
  );
});

async function headers(request: APIRequestContext, email = "admin@relay.demo") {
  const response = await request.post("/api/auth/login", {
    data: { email, password: process.env.DEMO_PASSWORD!, native: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

async function signIn(page: Page, email = "admin@relay.demo") {
  await page.goto("/");
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("dedicated branch form saves optional location atomically and handles stale location edits", async ({
  page,
  request,
}, info) => {
  test.setTimeout(150000);
  const auth = await headers(request),
    name = `Isolated branch-location ${Date.now()}`;
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await signIn(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Branches", exact: true })
    .click();
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Add branch", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Branch name", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Sign-in email", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByLabel("Reporting team leader", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Branch latitude", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("Branch name", { exact: true }).fill(name);
  await dialog
    .getByRole("checkbox", { name: /Add branch location and work radius/ })
    .check();
  await expect(
    dialog.getByLabel("Branch latitude", { exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByLabel("Branch longitude", { exact: true }),
  ).toHaveValue("");
  await dialog.getByLabel("Branch latitude", { exact: true }).fill("25.08");
  await dialog.getByLabel("Branch longitude", { exact: true }).fill("55.141");
  await dialog.getByLabel("Branch radius value", { exact: true }).fill("10");
  await dialog
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  expect(
    await dialog
      .getByLabel("Branch radius value", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
  ).toBe(true);
  expect(
    (
      await (
        await request.get("/api/resources/branches", { headers: auth })
      ).json()
    ).some((r: any) => r.name === name),
  ).toBe(false);
  await dialog.getByRole("button", { name: "500 m", exact: true }).click();
  const createdResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/organization/branches" &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  const created = await createdResponse;
  expect(created.ok(), await created.text()).toBeTruthy();
  const branch = await created.json();
  expect(created.request().postDataJSON().location).toEqual({
    latitude: 25.08,
    longitude: 55.141,
    radius_m: 500,
    enabled: true,
  });
  await expect(dialog.getByRole("status")).toContainText("Branch created");
  // Creating a branch does not unexpectedly replace its form with staff credentials.
  await expect(
    dialog.getByRole("heading", { name: "Add branch", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Sign-in email", { exact: true })).toHaveCount(
    0,
  );
  const saved = (
    await (
      await request.get(`/api/organization/branches/${branch.id}/location`, {
        headers: auth,
      })
    ).json()
  ).location;
  expect(saved).toMatchObject({
    latitude: 25.08,
    longitude: 55.141,
    radius_m: 500,
    enabled: true,
  });
  const fences = await (
    await request.get("/api/location-tracking/fences", { headers: auth })
  ).json();
  expect(fences.filter((f: any) => f.branch_id === branch.id)).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("branch-created-dedicated-form.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.goto(`/branches?selected=${branch.id}`);
  await dialog
    .getByRole("button", { name: "Edit branch location", exact: true })
    .click();
  const form = dialog.getByRole("form", {
    name: "Edit branch location",
    exact: true,
  });
  await expect(
    form.getByLabel("Branch radius value", { exact: true }),
  ).toHaveValue("500");
  const snapshot = Object.fromEntries(
    ["id", "latitude", "longitude", "radius_m", "enabled", "updated_at"].map(
      (k) => [k, saved[k]],
    ),
  );
  const concurrent = await request.put(
    `/api/organization/branches/${branch.id}/location`,
    {
      headers: auth,
      data: {
        location: {
          latitude: 25.08,
          longitude: 55.141,
          radius_m: 750,
          enabled: true,
        },
        expected: snapshot,
        reason: "Isolated second editor updated radius",
      },
    },
  );
  expect(concurrent.ok(), await concurrent.text()).toBeTruthy();
  // The live workspace may refresh the summary while this user's form is open.
  // The form must retain its original revision rather than silently adopting it.
  await expect(dialog.locator(".branch-location-heading")).toContainText(
    "750 m radius",
    { timeout: 15000 },
  );
  await expect(
    form.getByLabel("Branch radius value", { exact: true }),
  ).toHaveValue("500");
  await form.getByLabel("Branch radius value", { exact: true }).fill("1000");
  await form
    .getByLabel("Reason for location change", { exact: true })
    .fill("Isolated UI radius edit with stale snapshot");
  const conflict = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(`/${branch.id}/location`) &&
      r.request().method() === "PUT",
  );
  await form
    .getByRole("button", { name: "Save branch location", exact: true })
    .click();
  expect((await conflict).status()).toBe(409);
  await expect(form.getByRole("alert")).toContainText("Reload before saving");
  await form
    .getByRole("button", { name: "Reload branch location", exact: true })
    .click();
  await expect(
    form.getByLabel("Branch radius value", { exact: true }),
  ).toHaveValue("750");
  await form.getByLabel("Branch latitude", { exact: true }).fill("25.081");
  await form.getByLabel("Branch radius value", { exact: true }).fill("1000");
  await form
    .getByLabel("Reason for location change", { exact: true })
    .fill("Isolated UI edit after loading current snapshot");
  await form
    .getByRole("button", { name: "Save branch location", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Branch location saved",
  );
  const result = (
    await (
      await request.get(`/api/organization/branches/${branch.id}/location`, {
        headers: auth,
      })
    ).json()
  ).location;
  expect(result).toMatchObject({
    latitude: 25.081,
    longitude: 55.141,
    radius_m: 1000,
  });
  await expect(dialog.locator(".branch-location-heading")).toContainText(
    "1000 m radius",
  );
  await expect(dialog.locator(".branch-location-heading")).toContainText(
    "25.081, 55.141",
  );
  await fits(page);
  await page.screenshot({
    path: info.outputPath("branch-location-edited.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({
    path: info.outputPath("390-branch-location-edited.png"),
    animations: "disabled",
  });
  expect(failures).toEqual([]);
});

test("final commission preview is non-writing, apply is replay safe and agent sees only own amounts", async ({
  page,
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  const auth = await headers(request),
    ref = `isolated-final-${Date.now()}`,
    date = businessDate();
  const baseline = await (
    await request.get("/api/incentives/final", { headers: auth })
  ).json();
  const csv = `user_email,earned_on,amount,reference,note\nagent1@relay.demo,${date},125.25,${ref},Approved agent final amount\nleader@relay.demo,${date},60.00,${ref},Approved leader final amount\n`;
  await signIn(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Incentives", exact: true })
    .click();
  const section = page.getByRole("region", {
    name: "Final incentive tracking",
    exact: true,
  });
  await expect(
    section.getByRole("heading", {
      name: "Final commission amounts",
      exact: true,
    }),
  ).toBeVisible();
  const openImport = async () => {
    await section
      .getByRole("button", { name: "Import approved amounts", exact: true })
      .click();
    return page.getByRole("dialog", {
      name: "Import approved commission amounts",
    });
  };
  let dialog = await openImport();
  const attach = async () =>
    dialog.getByLabel("Final commission file", { exact: true }).setInputFiles({
      name: "approved-final.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await attach();
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "3. Review before importing" }),
  ).toBeVisible();
  await expect(dialog.locator(".commission-totals")).toContainText(
    "AED 185.25",
  );
  await expect(dialog.locator(".commission-preview-list li")).toHaveCount(2);
  await expect(dialog.locator(".commission-preview-list")).toContainText(
    "agent1@relay.demo",
  );
  expect(
    (
      await (
        await request.get("/api/incentives/final", { headers: auth })
      ).json()
    ).length,
  ).toBe(baseline.length);
  await dialog
    .getByRole("button", { name: "Import 2 new entries", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("2 entries added");
  await dialog
    .getByRole("button", { name: "View this month", exact: true })
    .click();
  await expect(
    section.locator("tbody tr").filter({ hasText: ref }),
  ).toHaveCount(2);
  dialog = await openImport();
  await attach();
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "This file is already recorded. There is nothing new to add.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Import 0 new entries", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  const records = await (
    await request.get("/api/incentives/final", { headers: auth })
  ).json();
  expect(records.filter((r: any) => r.reference === ref)).toHaveLength(2);
  const mine = records.find(
    (r: any) => r.reference === ref && r.user_email === "agent1@relay.demo",
  );
  await section
    .getByRole("combobox", { name: "Person", exact: true })
    .selectOption(mine.user_id);
  await expect(
    section.locator("tbody tr").filter({ hasText: ref }),
  ).toHaveCount(1);
  await expect(
    section.locator("tbody tr").filter({ hasText: ref }),
  ).toContainText("AED 125.25");
  await fits(page);
  await page.screenshot({
    path: info.outputPath("final-commission-filtered.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  const accountControl = await page
    .getByRole("button", { name: "Accounts & access", exact: true })
    .boundingBox();
  expect(accountControl).toBeTruthy();
  expect(accountControl!.x).toBeGreaterThanOrEqual(0);
  expect(accountControl!.x + accountControl!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("390-final-commission-filtered.png"),
    animations: "disabled",
  });
  const agentContext = await browser.newContext();
  try {
    const agent = await agentContext.newPage();
    await signIn(agent, "agent1@relay.demo");
    await agent
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Incentives", exact: true })
      .click();
    const own = agent.getByRole("region", {
      name: "Final incentive tracking",
      exact: true,
    });
    await expect(
      own.getByRole("heading", {
        name: "Final commission amounts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      own.getByLabel("Final commission file", { exact: true }),
    ).toHaveCount(0);
    await expect(
      own.getByRole("button", { name: "Preview import", exact: true }),
    ).toHaveCount(0);
    await expect(own.locator("tbody tr").filter({ hasText: ref })).toHaveCount(
      1,
    );
    await expect(
      own.locator("tbody tr").filter({ hasText: ref }),
    ).toContainText(mine.name);
    await expect(
      own.locator("tbody tr").filter({ hasText: ref }),
    ).not.toContainText("AED 60.00");
    const agentAuth = await headers(request, "agent1@relay.demo");
    const scoped = await (
      await request.get("/api/incentives/final", { headers: agentAuth })
    ).json();
    expect(scoped.every((r: any) => r.user_email === "agent1@relay.demo")).toBe(
      true,
    );
    const denied = await request.post("/api/incentives/final/import", {
      headers: agentAuth,
      data: {
        filename: "approved-final.csv",
        content_base64: Buffer.from(csv).toString("base64"),
        apply: true,
      },
    });
    expect(denied.status()).toBe(403);
    await agent.screenshot({
      path: info.outputPath("agent-final-amount-own-scope.png"),
      animations: "disabled",
    });
  } finally {
    await agentContext.close();
  }
});

test("rapid hard navigation keeps a signed-in Admin session despite interrupted refresh responses", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await signIn(page, "ops@relay.demo");
  // A full navigation can abandon a renewal after the server has already rotated it.
  // This reproduces rapid bookmark/reload usage rather than the normal SPA links.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const path of ["/branches", "/agents", "/inventory"])
      await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "SIM inventory", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add SIM", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: info.outputPath("admin-session-after-rapid-hard-navigation.png"),
    animations: "disabled",
  });
});

test("daily Admin retains branch stock actions while account and role controls stay Super admin only", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90000);
  await signIn(page, "ops@relay.demo");
  await expect(
    page.getByRole("button", { name: "Accounts & access", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Branches", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add branch", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Sales agents", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add sales agent", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "SIM inventory", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add SIM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import Excel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add SIM", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "SIM stock management", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("daily-admin-stock-management.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Import SIM stock", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Branch", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Reason for stock addition", { exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    path: info.outputPath("daily-admin-branch-stock-import.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({
    path: info.outputPath("390-daily-admin-branch-stock-import.png"),
    animations: "disabled",
  });
  const auth = await headers(request, "ops@relay.demo");
  expect(
    (await request.get("/api/organization/access", { headers: auth })).status(),
  ).toBe(403);
});
