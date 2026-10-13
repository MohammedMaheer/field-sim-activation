import { expect, Page, test } from "@playwright/test";
import { canManageMasterData } from "../src/api";
import { previewBuild } from "./preview";

async function workspace(page: Page, role: string, permissions: string[]) {
  await previewBuild(page);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    let data: unknown = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-workspace-grants",
        user: {
          id: "grant-audit",
          name: "Grant reviewer",
          role,
          permissions,
          agent_id: role === "Field Agent" ? "agent-one" : null,
        },
      };
    else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/branches")
      data = [{ id: "branch-one", name: "Marina Branch", agents: 1 }];
    else if (path === "/api/resources/agents")
      data = [
        {
          id: "agent-one",
          name: "Sales agent",
          employee_id: "QN-001",
          branch_id: "branch-one",
          branch: "Marina Branch",
          employment_status: "ACTIVE",
          target: 20,
          status: "ACTIVE",
        },
      ];
    else if (path === "/api/resources/team-leaders")
      data = [
        {
          id: "leader-one",
          leader_id: "leader-one",
          name: "Team leader",
          branch_id: "branch-one",
          branch: "Marina Branch",
          agents: 1,
          active: 1,
          stock: 2,
        },
      ];
    else if (path === "/api/resources/customers")
      data = [
        {
          id: "customer-one",
          name: "Avery Stone",
          nationality: "United Arab Emirates",
        },
      ];
    else if (path === "/api/resources/inventory")
      data = [
        {
          id: "sim-one",
          iccid: "8999710000000000001",
          serial: "SIM-ONE",
          status: "AVAILABLE",
          branch: "Marina Branch",
          branch_id: "branch-one",
          business_category: "POSTPAID",
        },
      ];
    else if (path === "/api/field-assets")
      data = [
        {
          id: "asset-one",
          category: "UNIFORM",
          label: "Uniform",
          quantity: 2,
          status: "AVAILABLE",
          branch_id: "branch-one",
          branch: "Marina Branch",
        },
      ];
    return route.fulfill({ json: data });
  });
}

for (const role of ["Administrator", "Operations Manager"]) {
  test(`${role}: organization grants control all add/edit shortcuts`, async ({
    page,
  }) => {
    await workspace(page, role, ["read"]);
    for (const [route, button] of [
      ["branches", "Add branch"],
      ["agents", "Add sales agent"],
      ["team-leaders", "Add team leader"],
      ["customers", "Manage customers"],
    ]) {
      await page.goto("/" + route);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: button, exact: true }),
      ).toHaveCount(0);
    }
    await page.goto("/team-leaders");
    await expect(
      page.getByRole("button", { name: "Edit details", exact: true }),
    ).toHaveCount(0);
  });
  test(`${role}: authorized management retains branch and agent setup`, async ({
    page,
  }) => {
    await workspace(page, role, [
      "read",
      role === "Administrator" ? "settings.write" : "task.write",
    ]);
    for (const [route, button] of [
      ["branches", "Add branch"],
      ["agents", "Add sales agent"],
      ["team-leaders", "Add team leader"],
      ["customers", "Manage customers"],
    ]) {
      await page.goto("/" + route);
      await expect(
        page.getByRole("button", { name: button, exact: true }),
      ).toBeVisible();
    }
  });
}

for (const role of [
  "Administrator",
  "Operations Manager",
  "Inventory Manager",
  "Field Agent",
]) {
  test(`${role}: revoked stock grants hide stock mutations and requests`, async ({
    page,
  }) => {
    await workspace(page, role, ["read"]);
    await page.goto("/equipment");
    await expect(
      page.getByRole("heading", { name: "Assets & supplies", exact: true }),
    ).toBeVisible();
    for (const action of ["Add asset", "Move / update", "Issue stock"])
      await expect(
        page.getByRole("button", { name: action, exact: true }),
      ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Asset sections" })
      .getByRole("button", { name: /^Requests/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Request stock", exact: true }),
    ).toHaveCount(0);
  });
}

test("stock management keeps its own grant separate from organization management", async ({
  page,
}) => {
  await workspace(page, "Administrator", ["read", "inventory.write"]);
  await page.goto("/inventory");
  await expect(
    page.getByRole("button", { name: "Add SIM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import Excel", exact: true }),
  ).toBeVisible();
  await page.goto("/equipment");
  await expect(
    page.getByRole("button", { name: "Add asset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move / update", exact: true }),
  ).toBeVisible();
  await page.goto("/branches");
  await expect(
    page.getByRole("button", { name: "Add branch", exact: true }),
  ).toHaveCount(0);
});

test("embedded administration requires read plus its exact resource grant", () => {
  for (const role of ["Administrator", "Operations Manager"]) {
    const management =
      role === "Administrator" ? "settings.write" : "task.write";
    for (const kind of [
      "branches",
      "agents",
      "customers",
      "inventory",
      "incentives",
    ]) {
      expect(canManageMasterData({ role, permissions: ["read"] }, kind)).toBe(
        false,
      );
      const required =
        kind === "inventory"
          ? "inventory.write"
          : kind === "incentives"
            ? "incentive.write"
            : management;
      expect(canManageMasterData({ role, permissions: [required] }, kind)).toBe(
        false,
      );
      expect(
        canManageMasterData({ role, permissions: ["read", required] }, kind),
      ).toBe(true);
    }
  }
  for (const role of [
    "Field Agent",
    "Team Leader",
    "Sales Manager",
    "Compliance Officer",
    "Inventory Manager",
  ])
    expect(
      canManageMasterData(
        {
          role,
          permissions: [
            "read",
            "settings.write",
            "task.write",
            "inventory.write",
            "incentive.write",
          ],
        },
        "customers",
      ),
    ).toBe(false);
});
