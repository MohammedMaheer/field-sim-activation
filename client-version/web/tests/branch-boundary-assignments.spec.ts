import { expect, test } from "@playwright/test";
import path from "node:path";
import { setup, fence, branches } from "./location-fixture";

for (const width of [390, 800, 1440]) {
  test(`branch and individual assignment filters are clear at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page);
    let replaced = false;
    await page.route(
      "**/api/location-tracking/branch-assignments*",
      async (route) => {
        if (route.request().method() === "PUT") {
          fixture.writes.push({
            path: new URL(route.request().url()).pathname,
            body: route.request().postDataJSON(),
          });
          replaced = true;
          return route.fulfill({
            json: {
              member_count: 3,
              replaced_individual_count: 1,
              boundary: fence,
            },
          });
        }
        return route.fulfill({
          json: branches.map((branch) => ({
            ...branch,
            member_count: branch.id === "marina" ? 3 : 1,
            individual_count: branch.id === "marina" && !replaced ? 1 : 0,
            boundary: branch.id === "marina" ? fence : null,
          })),
        });
      },
    );
    await page.goto("/location-tracking");
    await page
      .getByRole("button", { name: "Manage boundaries", exact: true })
      .click();
    await expect(page.getByLabel("Assign boundaries to")).toHaveValue("branch");
    await expect(
      page.getByRole("button", { name: "Assign boundary for Jordan Vale" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Assign branch boundary for Marina Branch",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: path.resolve(`../output/qa/boundary87-branches-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Assign branch boundary for Marina Branch" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("3 members", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/200 m radius/)).toBeVisible();
    const apply = dialog.getByRole("button", {
      name: "Apply to all branch members",
    });
    await expect(apply).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: /Replace individual boundaries/ })
      .check();
    await expect(apply).toBeEnabled();
    await apply.scrollIntoViewIfNeeded();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(`../output/qa/boundary87-apply-${width}.png`),
    });
    await apply.click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.writes).toContainEqual({
      path: "/api/location-tracking/branch-assignments/marina",
      body: { fence_id: fence.id, replace_individual: true },
    });
    await page.getByLabel("Assign boundaries to").selectOption("individual");
    await expect(
      page.getByRole("button", { name: "Assign boundary for Jordan Vale" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Assign branch boundary for Marina Branch",
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Assign boundary for Jordan Vale" })
      .click();
    await expect(
      page.getByRole("radio", { name: /Use branch boundary/ }),
    ).toBeChecked();
    expect(
      fixture.writes.filter((item) => item.path.endsWith("/settings")),
    ).toHaveLength(0);
  });
}

test("branch assignment explains missing worksite and recovers from an apply error", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/location-tracking");
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Assign branch boundary for Downtown Branch" })
    .click();
  const dialog = page.getByRole("dialog");
  const apply = dialog.getByRole("button", {
    name: "Apply to all branch members",
  });
  await expect(apply).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Create branch worksite" }),
  ).toBeVisible();
  await dialog.getByLabel("Boundary for this branch").selectOption(fence.id);
  await expect(apply).toBeEnabled();
  await page.route(
    "**/api/location-tracking/branch-assignments/downtown",
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          detail:
            "This branch now has individual boundaries. Refresh and try again.",
        },
      }),
  );
  await apply.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "individual boundaries",
  );
  await expect(apply).toBeEnabled();
  await expect(dialog).toBeVisible();
});

test("branch management stays hidden for a team leader", async ({ page }) => {
  const fixture = await setup(page, {
    role: "Team Leader",
    manage: false,
    read: true,
  });
  await page.goto("/location-tracking");
  await expect(page.getByLabel("Assign boundaries to")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Assign branch boundary/ }),
  ).toHaveCount(0);
  expect(fixture.requests).not.toContain(
    "/api/location-tracking/branch-assignments",
  );
});

test("shared branch selection filters branch and individual assignment views", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/location-tracking");
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page
    .getByLabel("Branch", { exact: true })
    .first()
    .selectOption("marina");
  await expect(
    page.getByRole("button", {
      name: "Assign branch boundary for Marina Branch",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Assign branch boundary for Downtown Branch",
    }),
  ).toHaveCount(0);
  await page.getByLabel("Assign boundaries to").selectOption("individual");
  await expect(
    page.getByRole("button", { name: "Assign boundary for Jordan Vale" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assign boundary for Mira Rowan" }),
  ).toHaveCount(0);
});
