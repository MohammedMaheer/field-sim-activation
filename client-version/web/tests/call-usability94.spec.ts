import { expect, Page, test } from "@playwright/test";

async function workspace(page: Page, write = true) {
  let mode = "reject",
    release: (() => void) | undefined;
  const calls: { path: string; body: any }[] = [],
    errors: string[] = [];
  const historyQueries: URL[] = [];
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    id: `call-${index}`,
    sale_id: `sale-${index}`,
    customer_name: `Customer ${index}`,
    request_id: `SR-94-${index}`,
    msisdn: `05000000${String(index).padStart(2, "0")}`,
    stage: "TELE_VERIFICATION",
    status: "PENDING",
    plan_name: "New postpaid",
    branch: "Marina Branch",
    agent: "Sales One",
    last_outcome: "NO_ANSWER",
  }));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/sales-management/calls")
      historyQueries.push(new URL(request.url()));
    if (request.method() === "POST" && path.includes("/sales/")) {
      calls.push({ path, body: request.postDataJSON() });
      if (mode === "wait")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return route.fulfill(
        mode === "reject"
          ? {
              status: 409,
              json: { detail: "This call changed. Check before trying again." },
            }
          : { json: { status: "COMPLETED" } },
      );
    }
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-call-check",
        user: {
          id: "call-reviewer",
          name: "Call reviewer",
          role: "Administrator",
          permissions: [
            "read",
            "call.tele.read",
            ...(write ? ["call.tele.write"] : []),
          ],
        },
      };
    else if (path === "/api/resources/branches")
      data = [{ id: "marina", name: "Marina Branch" }];
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/sales-management/call-tasks") data = tasks;
    else if (path === "/api/sales-management/call-tasks/summary")
      data = {
        actionable: 12,
        pending_tele: 12,
        pending_welcome: 0,
        blocked_welcome: 0,
      };
    return route.fulfill({ json: data });
  });
  return {
    calls,
    historyQueries,
    errors,
    accept: () => {
      mode = "accept";
    },
    hold: () => {
      mode = "wait";
    },
    release: () => release?.(),
  };
}

for (const width of [1440, 390]) {
  test(`call action opens at the clicked customer and retains a failed save at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const audit = await workspace(page);
    await page.goto("/call-work");
    await page
      .getByRole("button", { name: "Record call", exact: true })
      .last()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Record call outcome",
      exact: true,
    });
    await expect(dialog).toBeInViewport();
    await expect(
      dialog.getByRole("heading", { name: "Customer 11", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText("SR-94-11", { exact: true })).toBeVisible();
    await expect(dialog.getByText("0500000011", { exact: true })).toBeVisible();
    await dialog
      .getByLabel("Outcome", { exact: true })
      .selectOption("NO_ANSWER");
    await dialog
      .getByLabel("Call remark", { exact: true })
      .fill("Customer asked to call again tomorrow");
    await dialog
      .getByRole("button", { name: "Save outcome", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("This call changed");
    await expect(dialog.getByLabel("Call remark", { exact: true })).toHaveValue(
      "Customer asked to call again tomorrow",
    );
    await expect(dialog.getByLabel("Outcome", { exact: true })).toHaveValue(
      "NO_ANSWER",
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../output/qa/usability94-call-outcome-${width}.png`,
      animations: "disabled",
    });
    audit.hold();
    await dialog
      .getByRole("button", { name: "Save outcome", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(audit.calls).toHaveLength(2);
    audit.release();
    await expect(dialog).toHaveCount(0);
    expect(audit.calls[1]).toEqual({
      path: "/api/sales-management/sales/sale-11/calls",
      body: {
        stage: "TELE_VERIFICATION",
        outcome: "NO_ANSWER",
        remark: "Customer asked to call again tomorrow",
      },
    });
    expect(audit.errors).toEqual([]);
  });
}

test("postponement keeps its technical reason after an error and has an explicit cancel", async ({
  page,
}) => {
  const audit = await workspace(page);
  let browserPrompts = 0;
  page.on("dialog", (dialog) => {
    browserPrompts++;
    void dialog.dismiss();
  });
  await page.goto("/call-work");
  await page
    .getByRole("button", { name: "Postpone to next day", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Postpone tele-verification",
    exact: true,
  });
  await expect(dialog.getByText("SR-94-11", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Postpone to next day", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Technical reason", { exact: true })
    .fill("Carrier system temporarily unavailable");
  await dialog
    .getByRole("button", { name: "Postpone to next day", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("This call changed");
  await expect(
    dialog.getByLabel("Technical reason", { exact: true }),
  ).toHaveValue("Carrier system temporarily unavailable");
  audit.accept();
  await dialog
    .getByRole("button", { name: "Postpone to next day", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(audit.calls[1].path).toContain("/sale-11/calls/defer-tele");
  expect(browserPrompts).toBe(0);
  expect(audit.errors).toEqual([]);
});

test("call search recovers and read-only callers only see history", async ({
  page,
}) => {
  const audit = await workspace(page, false);
  await page.goto("/call-work?selected=call-11");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record call", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Postpone to next day", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Find a call", { exact: true }).fill("SR-94-11");
  await expect(page.locator(".call-task")).toHaveCount(1);
  await page.getByLabel("Find a call", { exact: true }).fill("Nothing matches");
  await expect(
    page.getByText("No calls in this view", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".call-task")).toHaveCount(12);
  await page
    .getByRole("button", { name: "History", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("No calls recorded for this stage yet.", { exact: true }),
  ).toBeVisible();
  expect(audit.historyQueries[0].searchParams.get("sale_id")).toBe("sale-11");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Find a call", { exact: true }).fill("SR-94-0");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByText("No calls recorded for this stage yet.", { exact: true }),
  ).toBeVisible();
  expect(audit.historyQueries).toHaveLength(2);
  expect(audit.historyQueries[1].searchParams.get("sale_id")).toBe("sale-0");
  expect(audit.calls).toEqual([]);
  expect(audit.errors).toEqual([]);
});
