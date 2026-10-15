import { expect, test } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";
const account =
  process.env.RELAY_WITHDRAWAL_ACCOUNT || "demo.agent.1@relay.demo";

test.beforeEach(() => {
  const url = new URL(process.env.RELAY_WEB_URL || "http://localhost:5174");
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["localhost", "127.0.0.1"].includes(url.hostname),
    "Disposable loopback QA database only",
  );
});

test("web withdrawal closes matching saved/active drafts and records one scoped feedback without a sale", async ({
  page,
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: {
      email: account,
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const identity = await login.json(),
    headers = { Authorization: `Bearer ${identity.access_token}` };
  const get = async (path: string) =>
    (await request.get("/api" + path, { headers })).json();
  const before = await get("/kyc-captures/draft");
  const transaction_id = crypto.randomUUID(),
    name = "QA86 Web withdrawal " + Date.now();
  const data = {
    transaction_id,
    name,
    step: 0,
    capture_mode: "SCREENSHOT_SALE",
  };
  const active = await request.put("/api/kyc-captures/draft", {
    headers,
    data: { version: before.version, data },
  });
  expect(active.ok(), await active.text()).toBe(true);
  const saved = await request.post("/api/kyc-captures/saved-drafts", {
    headers,
    data: { data },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const salesBefore = (await get("/sales-management/sales"))
    .map((row: any) => row.id)
    .sort();
  const capturesBefore = (await get("/kyc-captures"))
    .map((row: any) => row.id)
    .sort();
  await page.goto("/");
  await page.locator("input[type=email]").fill(account);
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(page.locator("input[type=password]")).toBeHidden({
    timeout: 30000,
  });
  await page.goto("/kyc-capture");
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(name);
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Note · optional")
    .fill("Customer needs more time; synthetic QA only.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record & close draft", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sales\?tab=feedback/);
  await expect(page.getByRole("cell").filter({ hasText: name })).toBeVisible({
    timeout: 15000,
  });
  const feedback = (await get("/sales-management/feedback")).filter(
    (row: any) => row.customer_name === name,
  );
  expect(feedback).toHaveLength(1);
  expect(feedback[0]).toMatchObject({
    agent_id: identity.user.agent_id,
    rejection_reason: "Customer backed out",
    product_suggested: "Not recorded",
  });
  expect(
    (await get("/kyc-captures/saved-drafts")).some(
      (row: any) => row.data.transaction_id === transaction_id,
    ),
  ).toBe(false);
  expect((await get("/kyc-captures/draft")).data).toEqual({});
  expect(
    (await get("/sales-management/sales")).map((row: any) => row.id).sort(),
  ).toEqual(salesBefore);
  expect((await get("/kyc-captures")).map((row: any) => row.id).sort()).toEqual(
    capturesBefore,
  );
  const retry = await request.post("/api/kyc-captures/customer-backed-out", {
    headers,
    data: {
      agent_id: identity.user.agent_id,
      transaction_id,
      version: before.version,
      data,
      note: "retry",
    },
  });
  expect(retry.ok(), await retry.text()).toBe(true);
  expect((await retry.json()).already_recorded).toBe(true);
  await page.screenshot({
    path: "../output/qa/customer-backed-out86-connected-feedback.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("mobile demo withdrawal reaches the same backend feedback", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  let outcome: any;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
      "/api/kyc-captures/customer-backed-out"
    )
      outcome = request.postDataJSON();
  });
  await mobileSignIn(page, account);
  await page
    .getByRole("button", { name: "Start transaction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New transaction", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Transaction options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Customer backed out", exact: true })
    .or(page.getByRole("button", { name: "Customer backed out", exact: true }))
    .or(page.getByText("Customer backed out", { exact: true }))
    .first()
    .click({ timeout: 15000 });
  await expect(
    page.getByText("Customer backed out?", { exact: true }),
  ).toBeVisible();
  const note = "QA86 Mobile demo withdrawal " + Date.now();
  const noteField = page.getByRole("textbox", { name: "Note · optional" });
  await noteField.click();
  await page.waitForTimeout(250);
  await page.keyboard.type(note, { delay: 20 });
  await expect(noteField).toHaveValue(note);
  await page.keyboard.press("Tab");
  await page
    .getByRole("button", { name: "Record customer backed out", exact: true })
    .click();
  await expect.poll(() => outcome?.note, { timeout: 30000 }).toBe(note);
  await expect(
    page.getByRole("heading", { name: "Sales management", exact: true }),
  ).toBeVisible();
  // Flutter combines the list into an unnamed semantics group, rather than
  // exposing a separate DOM text node for each canvas-rendered feedback note.
  await expect
    .poll(
      async () =>
        page.getByRole("region", { name: "Interactive phone" }).ariaSnapshot(),
      { timeout: 30000 },
    )
    .toContain(note);
  const login = await request.post("/api/auth/login", {
    data: {
      email: account,
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const token = (await login.json()).access_token;
  const response = await request.get("/api/sales-management/feedback", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  expect(
    (await response.json()).filter((row: any) => row.feedback === note),
  ).toHaveLength(1);
  await page.screenshot({
    path: "../output/qa/customer-backed-out86-mobile-demo-feedback.png",
    animations: "disabled",
  });
});
