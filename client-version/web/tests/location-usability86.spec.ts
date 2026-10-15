import { expect, test } from "@playwright/test";
import path from "node:path";
import { setup, fence } from "./location-fixture";

for (const width of [390, 800, 1440]) {
  test(`location tasks and popups stay separate and usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page);
    await page.goto("/location-tracking");
    await expect(
      page.getByRole("button", { name: "Live locations", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Add boundary", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Blocking/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("heading", { name: "Member work locations", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.resolve(`../output/qa/geofence86-live-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Manage boundaries", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Work location map", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Assign member boundaries",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.resolve(`../output/qa/geofence86-manage-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390) {
      const rows = await page
        .locator(".location-table tbody tr")
        .evaluateAll((elements) =>
          elements.map((row) => {
            const boundary = row.querySelector('[data-label="Work boundary"]')!;
            const actions = row.querySelector('[data-label="Actions"]')!;
            return {
              boundaryBottom: boundary.getBoundingClientRect().bottom,
              actionTop: actions.getBoundingClientRect().top,
            };
          }),
        );
      for (const row of rows)
        expect(row.actionTop).toBeGreaterThanOrEqual(row.boundaryBottom);
    }
    await page
      .getByRole("button", { name: "Assign boundary for Jordan Vale" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("radio", { name: /Use branch boundary/ }),
    ).toBeChecked();
    await expect(dialog.getByLabel("Boundary assignment")).toHaveCount(0);
    await dialog
      .getByRole("radio", { name: /Use another saved worksite/ })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Save boundary assignment" }),
    ).toBeDisabled();
    await dialog.getByLabel("Boundary assignment").selectOption(fence.id);
    await expect(
      dialog.getByRole("button", { name: "Save boundary assignment" }),
    ).toBeEnabled();
    await dialog
      .getByRole("radio", { name: /Set an individual boundary/ })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Save boundary assignment" }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Choose individual worksite" })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "1 Choose the worksite" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "2 Set the allowed radius" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "3 Save who uses this boundary" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Latitude", { exact: true })).toBeHidden();
    await dialog.getByRole("button", { name: "500 m", exact: true }).click();
    await dialog
      .getByText("Enter coordinates manually", { exact: true })
      .click();
    await dialog.getByLabel("Latitude", { exact: true }).fill("25.08");
    await dialog.getByLabel("Longitude", { exact: true }).fill("55.141");
    await dialog
      .getByRole("button", { name: "Save boundary", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(`../output/qa/geofence86-editor-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "Save boundary", exact: true })
      .click();
    expect(
      fixture.writes.find((write) =>
        write.path.endsWith("assignments/sales-agent/boundary"),
      )?.body,
    ).toMatchObject({
      latitude: 25.08,
      longitude: 55.141,
      radius_m: 500,
      branch_id: null,
    });
    expect(
      fixture.writes.filter((write) => write.path.endsWith("/settings")),
    ).toHaveLength(0);
    expect(fixture.requests).not.toContain(
      "/api/location-tracking/map-imagery",
    );
  });
}

test("a missing branch boundary is explained without inventing an assignment map", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/location-tracking/fences", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/location-tracking");
  await page
    .getByRole("button", { name: "Assign boundary for Jordan Vale" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(/This branch has no boundary yet/),
  ).toBeVisible();
  await expect(dialog.locator(".work-map")).toHaveCount(0);
});
