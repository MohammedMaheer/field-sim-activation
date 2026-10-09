import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

const policies = ["MBO_STAFF", "POSTPAID_TL", "MBO_TL", "SM_GATE"].map(
  (family, index) => ({
    id: `sample-policy-${index}`,
    family,
    name: `Approved October sample ${family} policy`,
    valid_from: "2026-10-01",
    valid_until: null,
    rules: {
      bands: [80, 90, 100, 110],
      monthly_rates: {
        NEW: { SLAB_1: [25, 30, 30, 50], SLAB_2: [50, 60, 75, 90] },
      },
      gate_rates: {
        GATE_1: {
          target: 1945,
          MNP: 12.5,
          NEW: 8,
          P2P: 5,
          slab3_mrc_percent: 5,
        },
      },
      notes: ["Sample eligibility condition retained for layout verification."],
    },
  }),
);
const row = {
  user_id: "sample-agent",
  name: "Sample Salesperson",
  role: "Field Agent",
  net_sales: 12,
  cancelled: 3,
  policy_name: policies[0].name,
  policy_id: policies[0].id,
  status: "CONFIGURATION_REQUIRED",
  amount: null,
  missing_inputs: ["monthly_target"],
  components: [
    {
      name: "MONTHLY_COMMISSION",
      amount: null,
      status: "CONFIGURATION_REQUIRED",
      reason: "Approved target and eligibility inputs are required.",
      missing_inputs: ["monthly_target"],
    },
  ],
};

async function commissionFixture(page: Page) {
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (["PUT", "PATCH", "DELETE"].includes(request.method())) writes++;
    let data: unknown = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-access",
        user: {
          id: "sample-admin",
          name: "Sample Administrator",
          role: "Administrator",
          permissions: ["incentive.write"],
        },
      };
    else if (path === "/api/notifications") data = { items: [], unread: 0 };
    else if (path === "/api/events/stream") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    } else if (path === "/api/commissions/summary")
      data = { rows: [row], can_configure: true };
    else if (path === "/api/commissions/policies") data = policies;
    else if (path === "/api/resources/plans")
      data = [{ id: "sample-plan", name: "Sample 5G Unlimited Plan" }];
    else if (path === "/api/resources/branches")
      data = [{ id: "sample-branch", name: "Sample Marina Branch" }];
    await route.fulfill({ json: data });
  });
  return () => writes;
}

async function fitsPage(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

for (const width of [1440, 390]) {
  test(`commission tables, breakdown and setup fit ${width}px without saving`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await previewBuild(page);
    const writes = await commissionFixture(page);
    await page.goto("/incentives");
    await expect(
      page.getByRole("heading", {
        name: "Commission calculations",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Breakdown", exact: true }),
    ).toBeVisible();
    await fitsPage(page);
    const approved = page.locator(".commission-policies");
    await approved.locator(":scope > summary").click();
    for (const policy of await approved.locator(".commission-policy").all()) {
      await policy.locator(":scope > summary").click();
      await expect(
        policy.getByRole("heading", { name: "Gate rates · AED per sale" }),
      ).toBeVisible();
    }
    await fitsPage(page);
    await page.screenshot({
      path: `../output/qa/commission-layout-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    for (const table of await page
      .locator(".commission-workspace .sales-table-wrap")
      .all()) {
      expect(
        await table.evaluate(
          (element) => element.getBoundingClientRect().width <= innerWidth,
        ),
      ).toBe(true);
      await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
    }
    await page.getByRole("button", { name: "Breakdown", exact: true }).click();
    const breakdown = page.getByRole("dialog", {
      name: "Commission breakdown · Sample Salesperson",
    });
    await expect(breakdown).toBeVisible();
    await expect(
      breakdown.getByText(
        "Approved target and eligibility inputs are required.",
      ),
    ).toBeVisible();
    expect(
      await breakdown.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Close details" }).click();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    const config = page.getByRole("dialog", {
      name: "Commission setup · Sample Salesperson",
    });
    await expect(config.getByLabel("Policy", { exact: true })).toBeVisible();
    for (const section of await config.locator("details").all()) {
        if ((await section.getAttribute("open")) === null)
        await section.locator(":scope > summary").click();
    }
    await expect(config.getByLabel("Approval note")).toBeVisible();
    expect(
      await config.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await fitsPage(page);
    await page.screenshot({
      path: `../output/qa/commission-configuration-${width}.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Close details" }).click();
    expect(writes()).toBe(0);
    expect(errors).toEqual([]);
  });
}
