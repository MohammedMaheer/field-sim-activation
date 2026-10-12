import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

async function fixture(page: Page, role: string, permissions: string[]) {
  await previewBuild(page);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    let data: unknown = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-grant-audit",
        user: {
          id: "grant-audit",
          name: "Grant reviewer",
          role,
          permissions,
          agent_id: "agent-one",
        },
      };
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/agents")
      data = [
        { id: "agent-one", name: "Sales agent", branch_id: "branch-one" },
      ];
    else if (path === "/api/resources/branches")
      data = [{ id: "branch-one", name: "Marina Branch" }];
    else if (path === "/api/sales-management/performance")
      data = {
        recorded: 1,
        closed: 0,
        in_progress: 1,
        monthly_target: 0,
        remaining: 0,
        by_product: {},
        daily_by_product: {},
        daily_summary: [],
      };
    else if (path === "/api/sales-management/staff")
      data = [
        {
          id: "staff-one",
          name: "Call officer",
          role: "Welcome Call Officer",
          email: "officer@example.test",
          branch: "Marina Branch",
        },
      ];
    else if (path === "/api/sales-management/sales")
      data = [
        {
          id: "sale-one",
          customer_name: "Avery Stone",
          agent: "Sales agent",
          branch: "Marina Branch",
          order_type: "NEW",
          request_id: "REQ-001",
          status: "IN_PROGRESS",
          created_at: "2026-10-12T08:00:00Z",
        },
      ];
    return route.fulfill({ json: data });
  });
  await page.goto("/sales");
  await expect(
    page.getByRole("heading", { name: "Sales management", exact: true }),
  ).toBeVisible();
}

for (const role of [
  "Administrator",
  "Operations Manager",
  "Team Leader",
  "Field Agent",
]) {
  test(`${role}: revoked mutation grants retain read access without editable actions`, async ({
    page,
  }) => {
    await fixture(page, role, ["read"]);
    await expect(
      page.getByRole("button", { name: "Correct", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Record sale", exact: true }),
    ).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Sales sections" });
    await expect(
      tabs.getByRole("button", { name: "Status import", exact: true }),
    ).toHaveCount(0);
    await tabs
      .getByRole("button", { name: "No-sale feedback", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add feedback", exact: true }),
    ).toHaveCount(0);
    await tabs.getByRole("button", { name: "Targets", exact: true }).click();
    await expect(page.getByLabel("Target file", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Download target file", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toHaveCount(0);
    if (["Administrator", "Operations Manager"].includes(role)) {
      await tabs
        .getByRole("button", { name: "Sales staff", exact: true })
        .click();
      await expect(
        page.getByText("Call officer", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add staff", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Edit assignment", exact: true }),
      ).toHaveCount(0);
    }
    await page.goto("/sales?tab=import");
    await expect(
      page.getByRole("heading", { name: "Sales register", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Update sale statuses", exact: true }),
    ).toHaveCount(0);
  });
}

test("administrator staff editing and sale correction require their separate grants", async ({
  page,
}) => {
  await fixture(page, "Administrator", ["read", "settings.write"]);
  await expect(
    page.getByRole("button", { name: "Correct", exact: true }),
  ).toHaveCount(0);
  const tabs = page.getByRole("navigation", { name: "Sales sections" });
  await expect(
    tabs.getByRole("button", { name: "Status import", exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole("button", { name: "Sales staff", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add staff", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit assignment", exact: true }),
  ).toBeVisible();
});

test("backend correction access does not silently grant staff assignment or target editing", async ({
  page,
}) => {
  await fixture(page, "Operations Manager", ["read", "compliance.write"]);
  await expect(
    page.getByRole("button", { name: "Correct", exact: true }),
  ).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Sales sections" });
  await expect(
    tabs.getByRole("button", { name: "Status import", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("button", { name: "Sales staff", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add staff", exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole("button", { name: "Targets", exact: true }).click();
  await expect(page.getByLabel("Target file", { exact: true })).toHaveCount(0);
});

test("sales capture and feedback remain available with the effective capture grant", async ({
  page,
}) => {
  await fixture(page, "Field Agent", ["read", "ekyc.write"]);
  await expect(
    page.getByRole("button", { name: "Record sale", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sales sections" })
    .getByRole("button", { name: "No-sale feedback", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add feedback", exact: true }),
  ).toBeVisible();
});
