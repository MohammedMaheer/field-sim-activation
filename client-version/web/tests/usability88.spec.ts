import { expect, Page, test } from "@playwright/test";
import path from "node:path";

async function setup(page: Page, role = "Administrator") {
  const writes: { path: string; body: any }[] = [];
  const branches = [
    { id: "marina", name: "Marina Branch" },
    { id: "downtown", name: "Downtown Branch" },
  ];
  const agents = branches.map((branch, index) => ({
    id: `agent-${index}`,
    name: `Sales person ${index}`,
    user_id: `member-${index}`,
    employee_id: `DEMO-${index}`,
    branch_id: branch.id,
    branch: branch.name,
    leader: `Leader ${index}`,
    leader_id: `leader-${index}`,
    target: 20,
    activations: 4,
    stock: 8,
    achievement: 20,
    aht: 2,
    ekyc_rate: 100,
    status: "ACTIVE",
  }));
  const asset = {
    id: "stock-one",
    label: "Staff uniform",
    category: "UNIFORM",
    serial: "Not recorded",
    quantity: 8,
    status: "AVAILABLE",
    branch_id: "marina",
    branch: "Marina Branch",
    agent_id: null,
    agent: "Unassigned",
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      target = url.pathname;
    if (target === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (
      ["POST", "PATCH", "PUT"].includes(request.method()) &&
      !target.startsWith("/api/auth/")
    ) {
      writes.push({ path: target, body: request.postDataJSON() });
      if (target === "/api/field-assets/import")
        return route.fulfill({
          json: {
            branch: "Marina Branch",
            count: 1,
            quantity: 3,
            rows: [{ label: "Uniform", quantity: 3 }],
          },
        });
      return route.fulfill({ json: { id: "saved" } });
    }
    let data: any = [];
    if (target === "/api/auth/refresh")
      data = {
        access_token: "isolated-usability-ui",
        user: {
          id: "reviewer",
          name: "UX reviewer",
          role,
          permissions: [
            "read",
            "report.read",
            ...(role === "Administrator"
              ? [
                  "settings.write",
                  "inventory.write",
                  "audit.read",
                  "incentive.write",
                ]
              : []),
          ],
        },
      };
    else if (target === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (target === "/api/resources/branches") data = branches;
    else if (target === "/api/resources/agents") data = agents;
    else if (target === "/api/resources/team-leaders")
      data = branches.map((branch, index) => ({
        ...branch,
        id: `leader-${index}`,
        leader_id: `leader-${index}`,
        branch_id: branch.id,
        branch: branch.name,
        name: `Leader ${index}`,
        agents: 1,
        active: 1,
        stock: 8,
      }));
    else if (target === "/api/organization") data = { branches, leaders: [] };
    else if (target === "/api/field-assets") data = [asset];
    else if (target === "/api/field-assets/report/summary") data = [];
    await route.fulfill({ json: data });
  });
  return { writes };
}

for (const width of [390, 800, 1440]) {
  test(`report choices and everyday controls remain compact at ${width}px`, async ({
    page,
  }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/reports");
    await expect(page.getByLabel("Report type", { exact: true })).toBeVisible();
    await expect(
      page.getByLabel("Report type", { exact: true }).locator("option"),
    ).toHaveCount(8);
    await page.getByLabel("Report type", { exact: true }).selectOption("audit");
    await expect(page.locator(".report-download-description")).toContainText(
      "responsible users",
    );
    await expect(
      page.getByRole("button", { name: "Download report", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", {
        name: "Export incentive tracking",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Open sales reports & exports",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.resolve(`../output/qa/usability88-reports-${width}.png`),
      fullPage: true,
    });
    if (width === 1440)
      expect(
        await page
          .locator("#workspace-content")
          .evaluate((el) => el.scrollHeight),
      ).toBeLessThan(1250);
  });
  test(`asset creation keeps optional data, branch choice and clear actions at ${width}px`, async ({
    page,
  }) => {
    const fixture = await setup(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/equipment");
    await expect(page.getByLabel("Branch stock file")).toBeHidden();
    await page
      .getByText("Import branch stock from Excel or CSV", { exact: true })
      .click();
    await expect(page.getByLabel("Branch stock file")).toBeDisabled();
    await page
      .locator(".stock-filters")
      .getByRole("combobox", { name: "Branch", exact: true })
      .selectOption("marina");
    await expect(page.getByLabel("Branch stock file")).toBeEnabled();
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add asset", exact: true });
    await expect(
      dialog.getByRole("combobox", { name: "Branch", exact: true }),
    ).toHaveValue("marina");
    await expect(dialog.getByLabel("Warehouse", { exact: true })).toBeHidden();
    await dialog
      .getByRole("combobox", { name: "Category", exact: true })
      .selectOption("__custom__");
    await dialog.getByLabel("Custom category code").fill("ACCESSORY");
    await dialog.getByLabel("Name", { exact: true }).fill("Branch charger");
    await dialog.getByText("Optional asset details", { exact: true }).click();
    await dialog.getByLabel("Warehouse", { exact: true }).fill("Branch store");
    await dialog
      .getByRole("button", { name: "Save asset", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(`../output/qa/usability88-add-asset-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "Save asset", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      fixture.writes.find((write) => write.path === "/api/field-assets")?.body,
    ).toMatchObject({
      category: "ACCESSORY",
      branch_id: "marina",
      quantity: 1,
      warehouse: "Branch store",
    });
  });
}

test("moving an asset only offers sales agents in its destination branch", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/equipment");
  await page
    .getByRole("button", { name: "Move / update", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: /Move or update/ });
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("downtown");
  const assignee = dialog.getByRole("combobox", {
    name: "Assigned sales agent",
    exact: true,
  });
  await expect(assignee.locator("option")).toHaveText([
    "Unassigned",
    "Sales person 1",
  ]);
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("ASSIGNED");
  await expect(assignee).toHaveAttribute("required", "");
  await assignee.selectOption("agent-1");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Moved to the destination branch");
  await dialog
    .getByRole("button", { name: "Save movement", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes[0].body).toMatchObject({
    branch_id: "downtown",
    agent_id: "agent-1",
    status: "ASSIGNED",
  });
});

test("agent list keeps all fields available while starting with key columns", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/agents");
  await expect(
    page.getByRole("columnheader", { name: "Team leader" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "AHT" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show all columns", exact: true })
    .click();
  await expect(page.getByRole("columnheader", { name: "AHT" })).toBeVisible();
  await page
    .getByRole("button", { name: "Show key columns", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("No matching person");
  await expect(
    page.getByRole("heading", { name: "No matching records" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View Sales person 0", exact: true }),
  ).toBeVisible();
});

test("team leader cards share one verification shortcut instead of repeating it", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/team-leaders");
  await expect(
    page.getByRole("link", { name: "Open backend verification", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".leader-card")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Change branch", exact: true }),
  ).toHaveCount(2);
});

test("read-only roles do not gain stock actions or an audit report choice", async ({
  page,
}) => {
  await setup(page, "Sales Manager");
  await page.goto("/equipment");
  await expect(
    page.getByRole("button", { name: "Add asset", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Move / update", exact: true }),
  ).toHaveCount(0);
  await page.goto("/reports");
  await expect(
    page
      .getByLabel("Report type", { exact: true })
      .locator('option[value="audit"]'),
  ).toHaveCount(0);
});

test("stock89: a successful import and a branch change clear the actual file picker", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/field-assets/import", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        applied: !!body.apply,
        branch: "Marina Branch",
        count: 1,
        quantity: 3,
        rows: [{ label: "Uniform", quantity: 3 }],
      },
    });
  });
  await page.goto("/equipment");
  await page
    .getByText("Import branch stock from Excel or CSV", { exact: true })
    .click();
  const branch = page
    .locator(".stock-filters")
    .getByRole("combobox", { name: "Branch", exact: true });
  await branch.selectOption("marina");
  const file = page.getByLabel("Branch stock file");
  const sample = {
    name: "stock.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Category,Name,Quantity\nUNIFORM,Uniform,3\n"),
  };
  await file.setInputFiles(sample);
  await page
    .getByRole("button", { name: "Preview branch stock import", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Receive stock in this branch", exact: true })
    .click();
  await expect(file).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Preview branch stock import",
      exact: true,
    }),
  ).toBeDisabled();
  await file.setInputFiles(sample);
  await expect(file).not.toHaveValue("");
  await branch.selectOption("downtown");
  await expect(file).toHaveValue("");
});

for (const action of ["add", "issue"]) {
  test(`stock89: reopening ${action} starts without a previous save error`, async ({
    page,
  }) => {
    await setup(page);
    const endpoint =
      action === "add"
        ? "**/api/field-assets"
        : "**/api/field-assets/stock-one/issue";
    await page.route(endpoint, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 422,
            json: { detail: "Previous stock save failed" },
          })
        : route.fallback(),
    );
    await page.goto("/equipment");
    const launch = page.getByRole("button", {
      name: action === "add" ? "Add asset" : "Issue stock",
      exact: true,
    });
    await launch.click();
    const dialog = page.getByRole("dialog");
    if (action === "add") {
      await dialog.getByLabel("Name", { exact: true }).fill("Uniform batch");
      await dialog
        .getByRole("combobox", { name: "Branch", exact: true })
        .selectOption("marina");
    } else {
      await dialog
        .getByRole("combobox", { name: "Sales agent", exact: true })
        .selectOption("agent-0");
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill("Issue uniform for work");
    }
    await dialog
      .getByRole("button", {
        name: action === "add" ? "Save asset" : "Issue stock",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Previous stock save failed",
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await launch.click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });
}

for (const action of ["move", "issue"]) {
  test(`stock89: ${action} stays open and submits only once while saving`, async ({
    page,
  }) => {
    await setup(page);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    await page.route(
      `**/api/field-assets/stock-one${action === "issue" ? "/issue" : ""}`,
      async (route) => {
        if (!["POST", "PATCH"].includes(route.request().method()))
          return route.fallback();
        writes++;
        await waiting;
        await route.fulfill({ json: { id: "saved" } });
      },
    );
    try {
      await page.goto("/equipment");
      await page
        .getByRole("button", {
          name: action === "move" ? "Move / update" : "Issue stock",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      if (action === "issue")
        await dialog
          .getByRole("combobox", { name: "Sales agent", exact: true })
          .selectOption("agent-0");
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill("Recorded branch stock change");
      await dialog.locator("form").evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      await expect.poll(() => writes).toBe(1);
      await expect(
        dialog.getByRole("button", { name: "Saving…", exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      release();
      await expect(dialog).toHaveCount(0);
      expect(writes).toBe(1);
    } finally {
      release();
    }
  });
}
