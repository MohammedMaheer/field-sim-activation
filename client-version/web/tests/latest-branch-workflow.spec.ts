import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";
import path from "node:path";

test("administrator inventory import follows the effective write grant", async ({page}) => {
  await fixture(page, "Administrator", ["read", "report.read"]);
  await page.goto("/inventory");
  await expect(page.getByRole("heading", {name: "SIM inventory", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Add SIM", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Import Excel", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Refresh", exact: true})).toBeVisible();
});

const branches = [
  {
    id: "branch-a",
    name: "Marina Branch",
    agents: 1,
    target: 20,
    closed_today: 1,
    closed_sales: 1,
  },
  {
    id: "branch-b",
    name: "Downtown Branch",
    agents: 1,
    target: 20,
    closed_today: 0,
    closed_sales: 0,
  },
];
const agents = branches.map((branch, index) => ({
  id: `agent-${index}`,
  name: index ? "Leila Arden" : "Zayn Mercer",
  employee_id: `RLY-10${index}`,
  branch_id: branch.id,
  branch: branch.name,
  outlet_id: `outlet-${index}`,
  outlet: branch.name,
  status: "ACTIVE",
  employment_status: "ACTIVE",
  target: 20,
  activations: 1,
  achievement: 5,
  stock: 8,
  aht: 6,
  ekyc_rate: 100,
  ocr: 99,
  last_sync: "2026-10-09T08:00:00Z",
  leader_id: index ? "leader-c" : "leader-a",
}));
const sale = {
  id: "sale-a",
  agent_id: "agent-0",
  agent: agents[0].name,
  branch_id: "branch-a",
  branch: branches[0].name,
  customer_name: "Jordan Vale",
  request_id: "REQ-001",
  reference: "REQ-001",
  sr_number: "SR-001",
  details: { sr_number: "SR-001" },
  status: "IN_PROGRESS",
  activation_state: "ACTIVATED_PENDING_SR_VERIFICATION",
  activation_label: "Activated · pending SR verification",
  sr_verification: { status: "PENDING_SR_VERIFICATION" },
  order_type: "NEW",
  plan_name: "Freedom 325",
  document: "•••• 0001",
  created_at: "2026-10-09T08:00:00Z",
};
const customer = {
  id: "customer-a",
  name: "Jordan Vale",
  mobile: "•••• 1234",
  document: "•••• 0001",
  nationality: "United Arab Emirates",
  agent: agents[0].name,
  agent_id: "agent-0",
  branch_id: "branch-a",
  branch: branches[0].name,
  sr_number: "SR-001",
  request_id: "REQ-001",
  details: {
    date_of_birth: "1996-09-08",
    issue_date: "2021-10-07",
    expiry_date: "2031-10-06",
    sex: "Female",
    document_type: "EMIRATES_ID",
    account_number: "ACCOUNT-001",
    alternate_number: "0500000001",
    msisdn: "0500000000",
  },
  sales: [sale],
  history: [sale],
};

async function fixture(page: Page, role = "Administrator", grants?: string[]) {
  await previewBuild(page);
  const writes: { path: string; body: any }[] = [];
  let leaders = [
    {
      id: "leader-a",
      name: "Mira Rowan",
      email: "mira@relay.demo",
      branch_id: "branch-a",
      agents: 1,
    },
    {
      id: "leader-b",
      name: "Avery Reed",
      email: "avery@relay.demo",
      branch_id: "branch-a",
      agents: 0,
    },
    {
      id: "leader-c",
      name: "Casey Hart",
      email: "casey@relay.demo",
      branch_id: "branch-b",
      agents: 1,
    },
    {
      id: "leader-free",
      name: "Taylor Quinn",
      email: "taylor@relay.demo",
      branch_id: null,
      agents: 0,
    },
  ];
  let targets = [
    {
      id: "target-a",
      agent_id: "agent-0",
      agent: agents[0].name,
      period: "2026-10",
      order_type: "NEW",
      daily_target: 5,
      monthly_target: 150,
    },
  ];
  const permissions =
    grants ??
    (role === "Tele Verification Officer"
      ? ["call.tele.read", "call.tele.write"]
      : role === "Sales Manager"
        ? ["read", "report.read"]
        : role === "Field Agent"
          ? ["read", "activation.write", "ekyc.write"]
          : [
              "read",
              "report.read",
              "settings.write",
              "inventory.write",
              "audit.read",
              "compliance.write",
              "incentive.write",
              ...(role === "Operations Manager"
                ? ["ekyc.write", "activation.write"]
                : []),
            ]);
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (
      ["PUT", "PATCH", "POST", "DELETE"].includes(request.method()) &&
      !path.startsWith("/api/auth/")
    )
      writes.push({ path, body: request.postDataJSON() });
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-access",
        user: {
          id: `user-${role}`,
          name: "Evaluation Staff",
          role,
          permissions,
          agent_id: role === "Field Agent" ? "agent-0" : null,
        },
      };
    else if (path === "/api/notifications")
      data = { items: [], categories: ["Workspace"], unread: 0 };
    else if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path === "/api/resources/plans")
      data = [{ id: "plan-a", name: "Freedom 325", price: 325 }];
    else if (path === "/api/kyc-captures/read-document")
      data = {
        name: "Jordan Vale",
        document_number: "SAMPLE-ID-001",
        nationality: "United Arab Emirates",
        birth_date: "1996-09-08",
        expiry_date: "2031-10-06",
        document_check: "synthetic-customer-check",
      };
    else if (path === "/api/kyc-captures/read-order")
      data = {
        order_type: "NEW",
        package_name: "Freedom 325",
        plan_name: "Freedom 325",
        plan_id: "plan-a",
        msisdn: "0500000000",
        order_reference: "REQUEST-ONLY-123",
        order_check: "synthetic-order-check",
      };
    else if (path === "/api/resources/branches") data = branches;
    else if (path === "/api/resources/agents")
      data = agents.filter(
        (row) =>
          !url.searchParams.get("branch_id") ||
          row.branch_id === url.searchParams.get("branch_id"),
      );
    else if (path === "/api/resources/team-leaders")
      data = leaders
        .filter(
          (row) =>
            row.branch_id &&
            (!url.searchParams.get("branch_id") ||
              row.branch_id === url.searchParams.get("branch_id")),
        )
        .map((row) => ({
          ...row,
          id: `${row.id}:${row.branch_id}`,
          leader_id: row.id,
          branch: branches.find((branch) => branch.id === row.branch_id)?.name,
          active: row.agents,
          stock: 8,
        }));
    else if (path === "/api/resources/customers") data = [customer];
    else if (path === "/api/resources/activations")
      data = [
        { ...sale, customer: customer.name, msisdn: customer.details.msisdn },
      ];
    else if (path === "/api/organization")
      data = {
        branches,
        outlets: branches.map((row, index) => ({
          id: `outlet-${index}`,
          branch_id: row.id,
          name: row.name,
        })),
        leaders,
      };
    else if (/^\/api\/organization\/branches\/[^/]+\/leaders$/.test(path)) {
      const branchId = path.split("/")[4];
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        leaders = leaders.map((row) =>
          body.leader_ids.includes(row.id)
            ? { ...row, branch_id: branchId }
            : row.branch_id === branchId
              ? { ...row, branch_id: null }
              : row,
        );
      }
      data = {
        branch: branches.find((row) => row.id === branchId),
        leaders: leaders.filter((row) => row.branch_id === branchId),
        available_leaders: leaders.filter((row) => !row.branch_id),
      };
    } else if (
      path.startsWith("/api/administration/teams/") &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON();
      leaders = leaders.map((row) =>
        row.id === path.split("/").at(-1) ? { ...row, ...body.values } : row,
      );
      data = { saved: true };
    } else if (path === "/api/sales-management/targets") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        targets = [
          ...targets.filter(
            (row) =>
              row.agent_id !== body.agent_id ||
              row.order_type !== body.order_type,
          ),
          { id: `target-${body.order_type}`, agent: agents[0].name, ...body },
        ];
        data = { saved: true };
      } else data = targets;
    } else if (path === "/api/sales-management/sales") data = [sale];
    else if (path === "/api/sales-management/performance")
      data = {
        recorded: 1,
        closed: 0,
        in_progress: 1,
        monthly_target: 150,
        remaining: 150,
        crr: 0,
        drr: 7,
        closed_today: 0,
        by_product: {},
        daily_by_product: {},
        daily_summary: [],
      };
    else if (path === "/api/kyc-captures/draft")
      data = { version: 0, data: {} };
    else if (path === "/api/sales-management/sr/email-status")
      data = { configured: false };
    else if (path === "/api/sales-management/sr/batches")
      data = [
        {
          id: "batch-a",
          business_date: "2026-10-09",
          filename: "daily-sr.xlsx",
          matched: 1,
          mismatch: 0,
          pending: 0,
        },
      ];
    else if (path === "/api/commissions/summary")
      data = { rows: [], can_configure: false };
    else if (path.startsWith("/api/agents/") && path.endsWith("/management"))
      data = {
        agent: agents[0],
        outlets: branches.map((row, index) => ({
          id: `outlet-${index}`,
          branch_id: row.id,
          branch: row.name,
        })),
        leaders,
      };
    else if (path.startsWith("/api/reports/")) {
      await route.fulfill({
        contentType: "text/csv",
        body: "reference,status\nREQ-001,IN_PROGRESS\n",
      });
      return;
    }
    await route.fulfill({ json: data });
  });
  return writes;
}
async function fits(page: Page) {
  if (await page.locator(".sidebar.open").count())
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("shared branch selection follows tabs, reload and report exports", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/agents");
  const filter = page
    .locator(".topbar")
    .getByRole("combobox", { name: "Branch", exact: true });
  await filter.selectOption("branch-a");
  await expect(
    page.getByRole("button", { name: "View Zayn Mercer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Leila Arden", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "SIM inventory", exact: true }).click();
  await expect(filter).toHaveValue("branch-a");
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(filter).toHaveValue("branch-a");
  const today = new Date(Date.now() + 4 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    today,
  );
  await expect(page.getByLabel("To date", { exact: true })).toHaveValue(today);
  await page.getByLabel("From date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-07");
  const request = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/reports/daily",
  );
  await page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "Historical daily activation" }),
    })
    .getByRole("button", { name: "CSV", exact: true })
    .click();
  const exported = new URL((await request).url());
  expect(exported.searchParams.get("branch_id")).toBe("branch-a");
  expect(exported.searchParams.get("start")).toBe("2026-10-01");
  expect(exported.searchParams.get("end")).toBe("2026-10-07");
  await page.reload();
  await expect(filter).toHaveValue("branch-a");
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    today,
  );
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-admin-reports-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-admin-reports-mobile.png",
  });
});

test("the review inbox identifies current screenshot sales without detailed intake", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/kyc-captures?*", (route) =>
    route.fulfill({
      json: [
        {
          id: "current-sale",
          agent_id: "agent-0",
          source_reference: "REQ-CURRENT",
          document_kind: "SALE_SCREENSHOTS",
          status: "SUBMITTED",
          created_at: "2026-10-10T08:00:00",
        },
        {
          id: "earlier-receipt",
          agent_id: "agent-0",
          source_reference: "OLD-RECEIPT",
          document_kind: "ACTIVATION_RECEIPT",
          status: "SUBMITTED",
          created_at: "2026-10-10T07:00:00",
        },
      ],
    }),
  );
  await page.goto("/kyc-capture");
  await expect(page.getByRole("button", { name: /REQ-CURRENT/ })).toContainText(
    "Sale submission",
  );
  await expect(
    page.getByRole("button", { name: /REQ-CURRENT/ }),
  ).not.toContainText("Historical receipt");
  await expect(page.getByRole("button", { name: /OLD-RECEIPT/ })).toContainText(
    "Historical receipt",
  );
});

test("administrator reviews but cannot capture; important navigation is first", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/kyc-capture");
  await expect(
    page.getByRole("button", { name: "New transaction capture", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Drafts", exact: true }),
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
  const links = await nav.getByRole("link").allTextContents();
  expect(links.indexOf("Backend verification")).toBeLessThan(
    links.indexOf("Sales agents"),
  );
  expect(links).toContain("Live operations");
  await page.goto("/sales");
  await expect(
    page.getByRole("button", { name: "Record sale", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Activated · pending SR verification", { exact: true }),
  ).toBeVisible();
});

test("multiple branch leaders can be selected and team leaders edited", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/branches");
  await page
    .getByRole("button", { name: "View Marina Branch", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Mira Rowan/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Avery Reed/ }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: /Taylor Quinn/ }).check();
  await page
    .getByLabel("Reason for change", { exact: true })
    .fill("Additional branch team leader");
  await page
    .getByRole("button", { name: "Save team leaders", exact: true })
    .click();
  await expect
    .poll(
      () =>
        writes.find(
          (row) => row.path === "/api/organization/branches/branch-a/leaders",
        )?.body.leader_ids,
    )
    .toEqual(["leader-a", "leader-b", "leader-free"]);
  await page.keyboard.press("Escape");
  await page.goto("/team-leaders");
  await page
    .locator(".leader-card")
    .filter({
      has: page.getByRole("heading", { name: "Avery Reed", exact: true }),
    })
    .getByRole("button", { name: "Edit team leader", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Team leader name", { exact: true })
    .fill("Avery Rowan");
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("branch-b");
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Approved branch leader assignment");
  await dialog
    .getByRole("button", { name: "Save team leader", exact: true })
    .click();
  await expect
    .poll(
      () =>
        writes.find((row) => row.path === "/api/administration/teams/leader-b")
          ?.body.values,
    )
    .toEqual({
      name: "Avery Rowan",
      email: "avery@relay.demo",
      branch_id: "branch-b",
    });
  await expect(
    page.getByRole("heading", { name: "Avery Rowan", exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-team-leaders-desktop.png",
  });
});

test("editing an unassigned team leader preserves the original null branch", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.route("**/api/resources/team-leaders*", (route) =>
    route.fulfill({
      json: [
        {
          id: "leader-free:unassigned",
          leader_id: "leader-free",
          name: "Taylor Quinn",
          branch_id: null,
          branch: "Not assigned",
          agents: 0,
          active: 0,
          stock: 0,
        },
      ],
    }),
  );
  await page.goto("/team-leaders");
  await page
    .getByRole("button", { name: "Edit team leader", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("branch-a");
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Approved initial branch assignment");
  await dialog
    .getByRole("button", { name: "Save team leader", exact: true })
    .click();
  await expect
    .poll(
      () =>
        writes.find(
          (row) => row.path === "/api/administration/teams/leader-free",
        )?.body,
    )
    .toEqual({
      values: {
        name: "Taylor Quinn",
        email: "taylor@relay.demo",
        branch_id: "branch-a",
      },
      expected: {
        name: "Taylor Quinn",
        email: "taylor@relay.demo",
        branch_id: null,
      },
      reason: "Approved initial branch assignment",
    });
  await expect(dialog).toHaveCount(0);
});

test("all product targets remain visible and save by product", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/sales?tab=targets&agent=agent-0");
  const management = page.getByRole("region", {
    name: "Product target management",
  });
  await expect(
    page.getByLabel("New postpaid daily target", { exact: true }),
  ).toHaveValue("5");
  for (const name of [
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
      () =>
        writes.find((row) => row.path === "/api/sales-management/targets")
          ?.body,
    )
    .toEqual({
      agent_id: "agent-0",
      order_type: "HW",
      period: new Date(Date.now() + 4 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 7),
      daily_target: 2,
      monthly_target: 60,
    });
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-product-targets-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-product-targets-mobile.png",
  });
});

test("customer details include SR, captured identity and linked sale history", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/customers");
  await page
    .getByRole("button", { name: "View Jordan Vale", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("SR-001", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByText("2031-10-06", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ACCOUNT-001", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "REQ-001", exact: true }),
  ).toHaveAttribute("href", "/sales?selected=sale-a");
  await expect(
    dialog.getByText("Activated · pending SR verification", { exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({
    animations: "disabled",
    path: "../output/qa/latest-customer-details-desktop.png",
  });
});

test("Sales Manager SR workspace is read-only", async ({ page }) => {
  const writes = await fixture(page, "Sales Manager");
  await page.goto("/sr-verification");
  await expect(
    page.getByRole("heading", { name: "Daily SR verification", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Daily SR report", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Preview matches", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("daily-sr.xlsx", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
});

test("call-only role can scope its queue without wider workspace access", async ({
  page,
}) => {
  await fixture(page, "Tele Verification Officer");
  await page.goto("/call-work");
  await expect(
    page.getByRole("heading", { name: "Call work queue", exact: true }),
  ).toBeVisible();
  const branch = page
    .locator(".topbar")
    .getByRole("combobox", { name: "Branch", exact: true });
  const scoped = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/sales-management/call-tasks" &&
      new URL(request.url()).searchParams.get("branch_id") === "branch-a",
  );
  await branch.selectOption("branch-a");
  await scoped;
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("link", { name: "Sales agents", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Backend verification", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "SIM inventory", exact: true }),
  ).toHaveCount(0);
  await fits(page);
  await page.screenshot({
    path: "../output/qa/latest-call-only-role-desktop.png",
    animations: "disabled",
  });
});

test("stale unauthorized branch selection is cleared", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "relay.branch.user-Administrator",
      "unavailable-branch",
    ),
  );
  await fixture(page);
  await page.goto("/agents");
  await expect(
    page
      .locator(".topbar")
      .getByRole("combobox", { name: "Branch", exact: true }),
  ).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("relay.branch.user-Administrator"),
      ),
    )
    .toBeNull();
});

test("a write-only caller cannot read notifications or the call queue", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  await fixture(page, "Tele Verification Officer", ["call.tele.write"]);
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", {
      name: "This page is not available for your role",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toHaveCount(0);
  expect(paths).not.toContain("/api/notifications");
  await page.goto("/call-work");
  await expect(
    page.getByRole("heading", {
      name: "This page is not available for your role",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Call work queue", exact: true }),
  ).toHaveCount(0);
  expect(paths).not.toContain("/api/sales-management/call-tasks");
  expect(paths).not.toContain("/api/sales-management/call-tasks/summary");
  expect(paths).not.toContain("/api/notifications");
});

for (const [role, permission] of [
  ["Tele Verification Officer", "call.tele.read"],
  ["Welcome Call Officer", "call.welcome.read"],
]) {
  test(`${role} with read access retains the notification bell and inbox`, async ({
    page,
  }) => {
    const paths: string[] = [];
    page.on("request", (request) =>
      paths.push(new URL(request.url()).pathname),
    );
    await fixture(page, role, [permission]);
    await page.goto("/call-work");
    await expect(
      page.getByRole("heading", { name: "Call work queue", exact: true }),
    ).toBeVisible();
    const bell = page.getByRole("button", {
      name: "Notifications",
      exact: true,
    });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(
      page.getByRole("heading", { name: /^Notifications/ }),
    ).toBeVisible();
    await expect.poll(() => paths.includes("/api/notifications")).toBe(true);
    await fits(page);
    await page.screenshot({
      path: `../output/qa/latest-notifications-${permission.replaceAll(".", "-")}.png`,
      animations: "disabled",
    });
  });
}

test("optional receipt reads printed SR and duplicate submission stays reviewable", async ({
  page,
}) => {
  const writes = await fixture(page, "Operations Manager");
  await page.route("**/api/kyc-captures/receipt-fields", (route) =>
    route.fulfill({
      json: {
        fields: { sr_number: "SR-PRINTED-456" },
        sr_check: "synthetic-receipt-proof",
        lines: ["SR Number: SR-PRINTED-456"],
      },
    }),
  );
  await page.route("**/api/kyc-captures/sale-submissions", async (route) => {
    writes.push({
      path: "/api/kyc-captures/sale-submissions",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 409,
      json: {
        detail:
          "This transaction or receipt is already recorded or being processed. Check your existing sales before submitting again.",
      },
    });
  });
  await page.goto("/kyc-capture");
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer details", exact: true }),
  ).toBeVisible();
  const sample = path.resolve("tests/fixtures/transaction-sample.png");
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(sample);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Jordan Vale",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Order details screen", { exact: true })
    .setInputFiles(sample);
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(
    "REQUEST-ONLY-123",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review & submit sale", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Upload screenshot", { exact: true })
    .setInputFiles(sample);
  await expect(
    page.getByRole("status").filter({ hasText: "SR number read from receipt" }),
  ).toBeVisible();
  await expect(page.getByText("SR-PRINTED-456", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit sale", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "already recorded or being processed" }),
  ).toBeVisible();
  const submission = writes.find(
    (row) => row.path === "/api/kyc-captures/sale-submissions",
  )?.body;
  expect(submission.intake.sr_number).toBe("SR-PRINTED-456");
  expect(submission.intake.receipt_sr_check).toBe("synthetic-receipt-proof");
  expect(submission.intake.order_reference).toBe("REQUEST-ONLY-123");
  await expect(
    page.getByRole("button", { name: "Submit sale", exact: true }),
  ).toBeEnabled();
  await fits(page);
  await page.screenshot({
    path: "../output/qa/latest-duplicate-receipt-review.png",
    animations: "disabled",
  });
});

test("a replacement receipt without SR restores the captured order SR", async ({
  page,
}) => {
  const writes = await fixture(page, "Operations Manager");
  await page.route("**/api/kyc-captures/read-order", (route) =>
    route.fulfill({
      json: {
        order_type: "NEW",
        package_name: "Freedom 325",
        plan_name: "Freedom 325",
        plan_id: "plan-a",
        msisdn: "0500000000",
        order_reference: "REQUEST-ONLY-123",
        sr_number: "SR-ORDER-123",
        order_check: "synthetic-order-check",
      },
    }),
  );
  let receiptNumber = 0;
  await page.route("**/api/kyc-captures/receipt-fields", (route) =>
    route.fulfill({
      json:
        ++receiptNumber === 1
          ? {
              fields: { sr_number: "SR-RECEIPT-456" },
              sr_check: "first-receipt-proof",
              lines: [],
            }
          : { fields: {}, sr_check: "", lines: [] },
    }),
  );
  await page.route("**/api/kyc-captures/sale-submissions", async (route) => {
    writes.push({
      path: "/api/kyc-captures/sale-submissions",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 409,
      json: {
        detail:
          "This transaction or receipt is already recorded or being processed. Check your existing sales before submitting again.",
      },
    });
  });
  await page.goto("/kyc-capture");
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  const sample = path.resolve("tests/fixtures/transaction-sample.png");
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(sample);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Jordan Vale",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Order details screen", { exact: true })
    .setInputFiles(sample);
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(
    "REQUEST-ONLY-123",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("SR-ORDER-123", { exact: true })).toBeVisible();
  const upload = page.getByLabel("Upload screenshot", { exact: true });
  await upload.setInputFiles(sample);
  await expect(page.getByText("SR-RECEIPT-456", { exact: true })).toBeVisible();
  await upload.setInputFiles({
    name: "replacement-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("replacement"),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "SR number not found" }),
  ).toBeVisible();
  await expect(page.getByText("SR-ORDER-123", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit sale", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "already recorded or being processed" }),
  ).toBeVisible();
  const intake = writes.find(
    (row) => row.path === "/api/kyc-captures/sale-submissions",
  )?.body.intake;
  expect(intake.sr_number).toBe("SR-ORDER-123");
  expect(intake).not.toHaveProperty("receipt_sr_check");
});
