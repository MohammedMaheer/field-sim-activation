import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

const eligible = new Set([
  "Administrator",
  "Operations Manager",
  "Sales Manager",
  "Team Leader",
  "Field Agent",
]);

async function fixture(
  page: Page,
  role: string,
  path: string,
  grants?: string[],
  failEarlier = false,
) {
  await previewBuild(page);
  const requests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (
      !eligible.has(role) &&
      (pathname.startsWith("/api/incentives/final") ||
        pathname.startsWith("/api/commissions/"))
    )
      return route.fulfill({
        status: 403,
        json: { detail: "Commission access is unavailable for this role" },
      });
    if (pathname === "/api/incentives" && failEarlier)
      return route.fulfill({
        status: 500,
        json: { detail: "Earlier ledger unavailable" },
      });
    let data: unknown = [];
    if (pathname === "/api/auth/refresh")
      data = {
        access_token: "synthetic-commission-scope-token",
        user: {
          id: "commission-scope-user",
          name: "Commission scope reviewer",
          role,
          permissions:
            grants ||
            (role === "Field Agent" ? ["read"] : ["read", "report.read"]),
          agent_id: role === "Field Agent" ? "agent-scope-one" : undefined,
        },
      };
    else if (pathname === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (pathname === "/api/resources/branches")
      data = [{ id: "branch-scope-one", name: "Marina Branch" }];
    else if (pathname === "/api/resources/agents")
      data = [
        {
          id: "agent-scope-one",
          name: "Scoped sales agent",
          employee_id: "SCOPE-001",
        },
      ];
    else if (pathname === "/api/incentives")
      data = [
        {
          id: "legacy-scoped-one",
          agent_id: "agent-scope-one",
          agent: "Scoped sales agent",
          employee_id: "SCOPE-001",
          period: "2026-10",
          amount: 45,
          source: "RECORDED",
          note: "Existing recorded incentive retained",
        },
      ];
    else if (pathname === "/api/incentives/final")
      data = [
        {
          id: "final-scoped-one",
          user_id: "commission-scope-user",
          name: "Commission scope reviewer",
          role,
          branch: "Marina Branch",
          team_leader: "Scoped team leader",
          amount: "125.25",
          earned_on: "2026-10-13",
          reference: "FINAL-SCOPE-001",
          note: "Approved final amount",
        },
      ];
    else if (pathname === "/api/commissions/subjects")
      data = [
        {
          id: "commission-scope-user",
          name: "Commission scope reviewer",
          role,
        },
      ];
    return route.fulfill({ json: data });
  });
  await page.goto(path);
  await expect(
    page.getByRole("heading", {
      name: path === "/reports" ? "Reports & exports" : "Incentives",
      exact: true,
    }),
  ).toBeVisible();
  return { requests, errors };
}

for (const role of ["Branch Manager", "Inventory Manager"]) {
  test(`${role}: recorded history remains usable without forbidden final commission requests`, async ({
    page,
  }) => {
    const { requests, errors } = await fixture(page, role, "/incentives");
    await expect(
      page.getByRole("heading", { name: "Incentive history", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Existing recorded incentive retained", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: "Final incentive tracking",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Calculated estimates and commission setup", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".error-state")).toHaveCount(0);
    expect(
      requests.some(
        (p) =>
          p.startsWith("/api/incentives/final") ||
          p.startsWith("/api/commissions/"),
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
  });
}

for (const role of eligible) {
  test(`${role}: authorized final ledger exposes only useful people filters`, async ({
    page,
  }) => {
    const { requests, errors } = await fixture(page, role, "/incentives");
    const ledger = page.getByRole("region", {
      name: "Final incentive tracking",
      exact: true,
    });
    await expect(
      ledger.getByRole("heading", {
        name: "Final commission amounts",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ledger.getByRole("cell", {
        name: /FINAL-SCOPE-001 Approved final amount/,
      }),
    ).toBeVisible();
    if (["Field Agent", "Team Leader"].includes(role)) {
      await expect(
        ledger.getByRole("combobox", { name: "Person", exact: true }),
      ).toHaveCount(0);
      await expect(
        ledger.getByRole("combobox", {
          name: "Reporting team leader",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(requests).not.toContain("/api/commissions/subjects");
    } else {
      await expect(
        ledger
          .getByRole("combobox", { name: "Person", exact: true })
          .locator("option[value='commission-scope-user']"),
      ).toHaveCount(1);
      expect(requests).toContain("/api/commissions/subjects");
    }
    expect(requests).toContain("/api/incentives/final");
    await expect(page.locator(".error-state")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const role of [
  "Branch Manager",
  "Compliance Officer",
  "Inventory Manager",
]) {
  test(`${role}: reports omit unauthorized final-amount exports and retain permitted reports`, async ({
    page,
  }) => {
    const { requests, errors } = await fixture(page, role, "/reports");
    await expect(
      page.getByRole("heading", { name: "Incentive tracking", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Export incentive tracking",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Historical daily activation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".error-state")).toHaveCount(0);
    expect(requests.some((p) => p.startsWith("/api/incentives/final"))).toBe(
      false,
    );
    expect(errors).toEqual([]);
  });
}

for (const role of ["Administrator", "Operations Manager", "Sales Manager"]) {
  test(`${role}: reports retain authorized final commission export controls`, async ({
    page,
  }) => {
    const { errors } = await fixture(page, role, "/reports");
    await expect(
      page.getByRole("heading", { name: "Incentive tracking", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: "Export incentive tracking format",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Export incentive tracking",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.locator(".error-state")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("final commissions stay available when earlier ledger fails and views load independently", async ({
  page,
}) => {
  const { requests } = await fixture(
    page,
    "Administrator",
    "/incentives",
    ["read", "report.read"],
    true,
  );
  await expect(
    page.getByRole("cell", { name: /FINAL-SCOPE-001/ }),
  ).toBeVisible();
  expect(requests).not.toContain("/api/incentives");
  expect(requests).not.toContain("/api/commissions/summary");
  await page
    .getByRole("button", { name: "Earlier records", exact: true })
    .click();
  await expect(page.locator(".error-state")).toBeVisible();
  await page
    .getByRole("button", { name: "Final commissions", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: /FINAL-SCOPE-001/ }),
  ).toBeVisible();
  await expect(page.locator(".error-state")).toHaveCount(0);
});

test("custom role without report permission can view amounts without an unusable export action", async ({
  page,
}) => {
  await fixture(page, "Sales Manager", "/incentives", ["read"]);
  await expect(
    page.getByRole("heading", {
      name: "Final commission amounts",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export final amounts", exact: true }),
  ).toHaveCount(0);
});

test("invalid date range does not display a false zero or allow export", async ({
  page,
}) => {
  await fixture(page, "Administrator", "/incentives");
  await page.getByLabel("From date", { exact: true }).fill("2026-12-31");
  await page.getByLabel("To date", { exact: true }).fill("2026-01-01");
  await expect(page.getByRole("alert")).toContainText("Choose both dates");
  await expect(
    page.getByRole("button", { name: "Export final amounts", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Recorded commission summary" }),
  ).toHaveCount(0);
});
