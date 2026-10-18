import { expect, test } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";

test("call recovery writes to the shared API and appears in the mobile queue", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(
        new URL(baseURL || "http://invalid").hostname,
      ),
    "Mutations require an explicitly opted-in isolated QA service",
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Work email", { exact: true }).fill("tele@relay.demo");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  const login = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/login",
  );
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  const session = await (await login).json();
  const token = session.access_token;
  // Create a current, actionable synthetic sale instead of depending on old
  // sample calls having a particular state or the call officer's branch.
  const opsLogin = await request.post("/api/auth/login", {
    data: { email: "ops@relay.demo", password: process.env.DEMO_PASSWORD! },
  });
  expect(opsLogin.ok()).toBe(true);
  const headers = {
    Authorization: `Bearer ${(await opsLogin.json()).access_token}`,
  };
  const agentResponse = await request.get("/api/resources/agents", { headers });
  const agent = (await agentResponse.json()).find(
    (row: any) =>
      !session.user.branch_id || row.branch_id === session.user.branch_id,
  );
  expect(agent).toBeTruthy();
  const created = await request.post("/api/sales-management/sales", {
    headers,
    data: {
      agent_id: agent.id,
      order_type: "NEW",
      customer_name: "Call recovery sample",
      plan_name: "Captured package",
      request_id: `QA-CALL94-${Date.now()}`,
      msisdn: "0500000094",
    },
  });
  expect(created.status()).toBe(201);
  const sale = await created.json();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Call work queue", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/sales-management/call-tasks", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  const task = (await response.json()).find(
    (row: any) =>
      row.sale_id === sale.id &&
      row.stage === "TELE_VERIFICATION" &&
      ["PENDING", "FAILED"].includes(row.status),
  );
  expect(task).toBeTruthy();
  await page.getByLabel("Find a call", { exact: true }).fill(task.request_id);
  await page
    .getByRole("button", { name: "Record call", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Record call outcome",
    exact: true,
  });
  await dialog.getByLabel("Outcome", { exact: true }).selectOption("NO_ANSWER");
  const remark = `QA call recovery ${Date.now()}`;
  await dialog.getByLabel("Call remark", { exact: true }).fill(remark);
  let reject = true;
  await page.route(
    `**/api/sales-management/sales/${task.sale_id}/calls`,
    (route) =>
      route.request().method() === "POST" && reject
        ? route.fulfill({
            status: 409,
            json: {
              detail: "The call could not be saved; entries are retained.",
            },
          })
        : route.continue(),
  );
  await dialog
    .getByRole("button", { name: "Save outcome", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("entries are retained");
  await expect(dialog.getByLabel("Call remark", { exact: true })).toHaveValue(
    remark,
  );
  reject = false;
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/sales-management/sales/${task.sale_id}/calls` &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Save outcome", exact: true })
    .click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "History", exact: true })
    .first()
    .click();
  await expect(page.getByText(remark, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const mobile = await context.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobileSignIn(mobile, "tele@relay.demo");
  const host = mobile.locator("#flutter-host");
  await expect(
    host.getByText("Call work queue", { exact: true }),
  ).toBeVisible();
  // Flutter's semantic input can acknowledge fill before the framework has
  // applied the edit. Type as a user and wait for the filtered queue to settle.
  await host.getByRole("textbox", { name: /Find a call/ }).click();
  await mobile.keyboard.type(task.request_id, { delay: 20 });
  await expect(
    host.getByRole("textbox", {
      name: /Call recovery sample.*Last outcome: No answer/,
    }),
  ).toBeVisible();
  const recordCall = host.getByRole("button", {
    name: "Record call",
    exact: true,
  });
  await expect(recordCall).toHaveCount(1);
  await recordCall.click();
  await expect(
    host.getByText("Record call outcome", { exact: true }),
  ).toBeVisible();
  await expect(
    host.getByText(`SR / request ID: ${task.request_id}`, { exact: false }),
  ).toBeVisible();
  await mobile.screenshot({
    path: "../output/qa/usability94-connected-mobile-call.png",
    animations: "disabled",
  });
  await host.getByRole("button", { name: "Cancel", exact: true }).click();
  await context.close();
  expect(errors).toEqual([]);
});
