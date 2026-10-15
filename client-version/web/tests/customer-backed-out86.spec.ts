import { expect, Page, test } from "@playwright/test";

async function setup(
  page: Page,
  role = "Field Agent",
  saved?: Record<string, any>,
) {
  const requests: any[] = [];
  const saleSubmissions: any[] = [];
  let failure = true;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "test",
        user: {
          id: "viewer",
          role,
          name: "Sales Agent",
          agent_id: role === "Field Agent" ? "agent-a" : null,
          permissions: ["read", "ekyc.write", "activation.write"],
        },
      };
    else if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/agents")
      data = [{ id: "agent-a", name: "Sales Agent" }];
    else if (path === "/api/kyc-captures/draft")
      data = { version: req.method() === "PUT" ? 8 : 7, data: {} };
    else if (path === "/api/kyc-captures/saved-drafts")
      data = saved ? [{ id: "saved-a", data: saved }] : [];
    else if (path === "/api/kyc-captures/customer-backed-out") {
      requests.push(req.postDataJSON());
      if (failure)
        return route.fulfill({
          status: 409,
          json: {
            detail:
              "This draft changed on another device. Your fields are kept.",
          },
        });
      data = {
        recorded: true,
        feedback_id: "feedback-a",
        already_recorded: false,
      };
    } else if (path === "/api/kyc-captures/sale-submissions")
      saleSubmissions.push(req.postDataJSON());
    else if (path === "/api/sales-management/feedback")
      data =
        requests.length && !failure
          ? [
              {
                id: "feedback-a",
                customer_name: "Partial Customer",
                product_suggested: "Not recorded",
                rejection_reason: "Customer backed out",
                feedback: "Needs more time",
                agent: "Sales Agent",
              },
            ]
          : [];
    else if (path === "/api/location-tracking/me")
      data = { enabled: false, can_capture: true, permissions: {} };
    else if (path === "/api/sales-management/summary")
      data = { daily: [], agents: [], targets: [], totals: {} };
    await route.fulfill({ json: data });
  });
  await page.goto("/kyc-capture");
  return { requests, saleSubmissions, succeed: () => (failure = false) };
}

test("unfinished customer can be kept, retried and recorded once without required OCR", async ({
  page,
}) => {
  const fixture = await setup(page);
  const field = page.getByLabel("Full name", { exact: true });
  await field.fill("Partial Customer");
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Customer backed out" });
  await expect(
    dialog.getByText("Partial Customer", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  expect(fixture.requests).toHaveLength(0);
  await expect(field).toHaveValue("Partial Customer");
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  await dialog.getByLabel("Note · optional").fill("Needs more time");
  await dialog.getByRole("button", { name: "Record & close draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText("another device");
  await expect(field).toHaveValue("Partial Customer");
  expect(fixture.requests[0]).toMatchObject({
    version: 7,
    agent_id: "agent-a",
    data: { name: "Partial Customer" },
  });
  expect(fixture.requests[0].data.document_image).toBeUndefined();
  fixture.succeed();
  await dialog.getByRole("button", { name: "Record & close draft" }).dblclick();
  await expect(page).toHaveURL(/\/sales\?tab=feedback/);
  await expect(
    page.getByRole("heading", { name: "No-sale feedback", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Customer backed out", exact: true }),
  ).toBeVisible();
  expect(fixture.requests).toHaveLength(2);
});

test("withdrawal dialog fits phone and large text without clipping controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  await page.addStyleTag({
    content: ".customer-backed-out-form {font-size:20px}",
  });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Keep editing" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Record & close draft" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../output/qa/customer-backed-out86-phone.png",
    animations: "disabled",
  });
});

test("capture waits for the draft and a late initialization cannot remount it", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  // setup installs the general API route; this newer route holds only draft reads.
  const initialized = setup(page);
  await page.route("**/api/kyc-captures/draft", async (route) => {
    reads++;
    await pending;
    await route.fulfill({ json: { version: 2, data: {} } });
  });
  await initialized;
  await expect(
    page.getByRole("status").filter({ hasText: "Preparing your transaction" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Customer details screen", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Customer backed out", exact: true }),
  ).toBeEnabled();
  const initializedReads = reads;
  await page.getByLabel("Full name", { exact: true }).fill("Ready Customer");
  await page.waitForTimeout(250);
  expect(reads).toBe(initializedReads);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Ready Customer",
  );
});

test("administrator has no capture or customer-withdrawal action", async ({
  page,
}) => {
  await setup(page, "Administrator");
  await expect(
    page.getByRole("heading", {
      name: "Transaction history",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Customer backed out", exact: true }),
  ).toHaveCount(0);
});

test("saved order and final review both close the correct transaction with its current version", async ({
  page,
}) => {
  const saved = {
    transaction_id: "saved-transaction-86",
    saved_draft_id: "saved-a",
    step: 1,
    name: "Saved Customer",
    document_check: "checked",
    document_image: "sensitive-image",
    order_check: "checked",
    order_image: "sensitive-order",
    order_reference: "REQ-86",
    plan_id: "plan-a",
    package_name: "Plan 100",
    msisdn: "0500000000",
    order_type: "NEW",
  };
  const fixture = await setup(page, "Field Agent", saved);
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await page.getByRole("button", { name: /Saved Customer/ }).click();
  await expect(
    page.getByRole("heading", { name: "Order & plan", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep editing" })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review & submit sale", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  fixture.succeed();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record & close draft" })
    .click();
  await expect(page).toHaveURL(/\/sales\?tab=feedback/);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]).toMatchObject({
    transaction_id: saved.transaction_id,
    version: 8,
    data: { step: 2, saved_draft_id: "saved-a" },
  });
  expect(fixture.requests[0].data.order_image).toBeUndefined();
  expect(fixture.saleSubmissions).toHaveLength(0);
});

test("a delayed withdrawal response cannot clear or redirect a newer interaction", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  let started = false;
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/kyc-captures/customer-backed-out", async (route) => {
    started = true;
    await hold;
    await route.fulfill({ json: { recorded: true } });
  });
  await page
    .getByRole("button", { name: "Customer backed out", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record & close draft" })
    .click();
  await expect.poll(() => started).toBe(true);
  const navigate = async (path: string) =>
    page.evaluate((path) => {
      history.pushState({}, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  await navigate("/sales?tab=feedback");
  await expect(
    page.getByRole("heading", { name: "No-sale feedback", exact: true }),
  ).toBeVisible();
  await navigate("/kyc-capture");
  await page.getByLabel("Full name", { exact: true }).fill("New Customer");
  release();
  await page.waitForTimeout(350);
  await expect(page).toHaveURL(/\/kyc-capture$/);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "New Customer",
  );
});
