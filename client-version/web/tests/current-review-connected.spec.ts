import { expect, Page, test, APIRequestContext } from "@playwright/test";

test.beforeEach(({ baseURL }) => {
  const host = new URL(baseURL || "http://invalid").hostname;
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(host),
    "Mutating review checks require an explicitly opted-in isolated localhost QA database",
  );
});

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
}

async function headers(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/login", {
    data: {
      email,
      password: process.env.DEMO_PASSWORD,
      native: true,
      device: "Isolated current screenshot review",
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}

test("current screenshot sale has independent comparison, correction and scoped read-only confirmation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240000);
  const reviewerHeaders = await headers(request, "compliance@relay.demo");
  const listing = await request.get(
    "/api/kyc-captures?include_samples=true&status=SUBMITTED&limit=100",
    { headers: reviewerHeaders },
  );
  expect(listing.status()).toBe(200);
  const candidates = (await listing.json()).filter(
    (row: any) =>
      row.document_kind === "SALE_SCREENSHOTS" &&
      (row.source_reference.startsWith("DEMO-82-") ||
        row.source_reference.startsWith("SAMPLE-REQ-")),
  );
  expect(
    candidates.length,
    "Fresh isolated screenshot-sale samples required",
  ).toBeGreaterThan(0);
  const picked =
    candidates.find((row: any) => row.source_reference === "DEMO-82-REQ-001") ||
    candidates[0];
  const captureUrl = `/api/kyc-captures/${picked.id}`;
  let capture = await (
    await request.get(captureUrl, { headers: reviewerHeaders })
  ).json();
  expect(capture.source_reference).toMatch(/^(DEMO-82-|SAMPLE-REQ-)/);
  expect(capture.intake.capture_mode).toBe("SCREENSHOT_SALE");
  expect(capture.intake.document_image).toBeTruthy();
  expect(capture.intake.order_image).toBeTruthy();
  const sales = await (
    await request.get("/api/sales-management/sales", {
      headers: reviewerHeaders,
    })
  ).json();
  const sale = sales.find((row: any) => row.capture_id === capture.id);
  expect(sale).toBeTruthy();
  expect(sale.status).not.toBe("CANCELLED");
  const originalSR = sale.sr_verification.status;
  const accounts = await (
    await request.get("/api/auth/mobile-demo/accounts")
  ).json();
  const agent = accounts.find(
    (row: any) => row.role === "Field Agent" && row.name === sale.agent,
  );
  const leader = accounts.find(
    (row: any) => row.role === "Team Leader" && row.name === sale.leader,
  );
  expect(agent).toBeTruthy();
  expect(leader).toBeTruthy();

  await signIn(page, "compliance@relay.demo");
  let detailUnavailable = true;
  await page.route(`**${captureUrl}`, (route) =>
    detailUnavailable
      ? route.fulfill({
          status: 503,
          json: { detail: "Evidence temporarily unavailable; retry" },
        })
      : route.continue(),
  );
  await page.goto(`/kyc-capture?capture=${capture.id}`);
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  detailUnavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const workspace = page.getByLabel("Transaction review workspace");
  await expect(workspace).toBeVisible();
  const customerImage = workspace.getByRole("img", {
    name: "Customer details",
    exact: true,
  });
  await expect(customerImage).toBeVisible();
  await expect
    .poll(() =>
      customerImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(workspace.locator(".review-data-scroll")).toContainText(
    capture.intake.name,
  );
  await expect(workspace.locator(".review-data-scroll")).toContainText(
    capture.intake.sr_number,
  );
  await expect(
    workspace.getByRole("button", { name: "Verify submission", exact: true }),
  ).toBeDisabled();
  await workspace
    .getByRole("button", { name: "Order details", exact: true })
    .click();
  const orderImage = workspace.getByRole("img", {
    name: "Order details",
    exact: true,
  });
  await expect(orderImage).toBeVisible();
  await expect
    .poll(() =>
      orderImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(workspace.locator(".review-data-scroll")).toContainText(
    capture.intake.order_reference,
  );
  await workspace
    .getByRole("button", { name: "Zoom in image", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Fit image", exact: true }),
  ).toHaveText("125%");
  await workspace
    .getByRole("button", { name: "Fit image", exact: true })
    .click();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/demo82-current-review-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace
    .getByLabel("Review note", { exact: true })
    .fill("Recheck the recorded order screenshot and SR reference.");
  await expect(
    workspace.getByRole("button", { name: "Verify submission", exact: true }),
  ).toBeDisabled();
  await workspace
    .getByRole("button", { name: "Request correction", exact: true })
    .click();
  await expect(
    workspace.getByRole("heading", {
      name: "Returned for correction",
      exact: true,
    }),
  ).toBeVisible();
  const agentHeaders = await headers(request, agent.email);
  capture = await (
    await request.get(captureUrl, { headers: agentHeaders })
  ).json();
  expect(capture.status).toBe("REJECTED");
  const correction = await request.patch(captureUrl + "/rows", {
    headers: agentHeaders,
    data: {
      version: capture.version,
      rows: capture.rows,
      reason: "Sales agent rechecked the original captured order and SR.",
    },
  });
  expect(correction.status(), await correction.text()).toBe(200);
  capture = await correction.json();
  const resubmitted = await request.post(captureUrl + "/submit", {
    headers: agentHeaders,
    data: { version: capture.version },
  });
  expect(resubmitted.status(), await resubmitted.text()).toBe(200);
  capture = await resubmitted.json();
  expect(capture.status).toBe("SUBMITTED");
  const leaderHeaders = await headers(request, leader.email);
  for (const roleHeaders of [agentHeaders, leaderHeaders]) {
    const denied = await request.post(captureUrl + "/review", {
      headers: roleHeaders,
      data: {
        version: capture.version,
        outcome: "VERIFIED",
        reason: "Unauthorized agent or leader verification must be blocked",
      },
    });
    expect(denied.status()).toBe(403);
  }
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const acknowledgement = workspace.getByLabel(
    "I checked the images against the customer, order and captured details.",
    { exact: true },
  );
  await expect(acknowledgement).toBeVisible();
  await workspace
    .getByLabel("Review note", { exact: true })
    .fill(
      "Customer, order screenshot, request ID and captured SR checked independently.",
    );
  await expect(
    workspace.getByRole("button", { name: "Verify submission", exact: true }),
  ).toBeDisabled();
  await acknowledgement.check();
  const confirmation = page.waitForResponse(
    (response) =>
      response.url().endsWith(captureUrl + "/review") &&
      response.request().method() === "POST",
  );
  await workspace
    .getByRole("button", { name: "Verify submission", exact: true })
    .click();
  const savedConfirmation = await confirmation;
  expect(savedConfirmation.status(), await savedConfirmation.text()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Backend confirmation complete",
      exact: true,
    }),
  ).toBeVisible();
  const verified = await (
    await request.get(captureUrl, { headers: reviewerHeaders })
  ).json();
  expect(verified.status).toBe("VERIFIED");
  expect(verified.sr_verification.status).toBe(originalSR);
  expect(verified.invoice.sale_status).toBe("CLOSED");

  for (const [account, roleHeaders] of [
    [agent, agentHeaders],
    [leader, leaderHeaders],
  ] as const) {
    const notices = await (
      await request.get("/api/notifications", { headers: roleHeaders })
    ).json();
    const matching = notices.items.find(
      (row: any) =>
        /backend/i.test(row.title) &&
        [
          `/kyc-capture?capture=${capture.id}`,
          `/sales?selected=${sale.id}`,
        ].includes(row.web_path),
    );
    expect(
      matching,
      `${account.role} must receive the same confirmed record`,
    ).toBeTruthy();
    const authorizedRecord = await request.get(captureUrl, {
      headers: roleHeaders,
    });
    expect(
      authorizedRecord.status(),
      `${account.role} can read the same confirmed record`,
    ).toBe(200);
    expect((await authorizedRecord.json()).status).toBe("VERIFIED");
    expect(matching.web_path).toMatch(
      /^(\/kyc-capture\?capture=|\/sales\?selected=)/,
    );
  }
});
