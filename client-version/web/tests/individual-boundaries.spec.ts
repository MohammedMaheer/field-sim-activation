import { expect, test } from "@playwright/test";
import { setup } from "./location-fixture";

test("member radius is visible before GPS and personal setup saves independently", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/location-tracking");
  await page
    .getByRole("button", { name: "Show Mira Rowan on map", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Mira Rowan's work boundary",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Selected work boundary"]'),
  ).toContainText("200 m radius");
  await page
    .getByRole("button", { name: "Set individual boundary", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Drop pin", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "500 m", exact: true }).click();
  await expect(dialog.getByLabel("Boundary radius value")).toHaveValue("500");
  await dialog
    .getByRole("button", { name: "Save boundary", exact: true })
    .click();
  const write = fixture.writes.find((row) =>
    row.path.endsWith("/assignments/leader/boundary"),
  );
  expect(write?.body).toMatchObject({
    branch_id: null,
    radius_m: 500,
    enabled: true,
  });
});

test("place search is explicit, positions the pin and updates coordinates", async ({
  page,
}) => {
  const fixture = await setup(page);
  const queries: string[] = [];
  await page.route("**/api/location-tracking/place-search?**", (route) => {
    queries.push(route.request().url());
    return route.fulfill({
      json: {
        results: [
          {
            id: "place-1",
            name: "Marina public worksite, Dubai",
            latitude: 25.08,
            longitude: 55.141,
          },
        ],
      },
    });
  });
  await page.goto("/location-tracking");
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page.getByRole("button", { name: "Add boundary", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Search place or address")
    .fill("Marina public worksite");
  expect(queries).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Search place", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Marina public worksite, Dubai", exact: true })
    .click();
  await expect(dialog.getByLabel("Latitude", { exact: true })).toHaveValue(
    "25.08",
  );
  await expect(dialog.getByLabel("Longitude", { exact: true })).toHaveValue(
    "55.141",
  );
  await expect(
    dialog.getByRole("button", { name: "Boundary center pin", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Boundary name").fill("New public worksite");
  await dialog.getByRole("button", { name: "250 m", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save boundary", exact: true })
    .click();
  expect(
    fixture.writes.find((row) => row.path.endsWith("/fences"))?.body,
  ).toMatchObject({ latitude: 25.08, longitude: 55.141, radius_m: 250 });
  expect(queries).toHaveLength(1);
});

test("an unassigned member never inherits the viewer boundary in the map preview", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/location-tracking/members?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            user_id: "unassigned",
            name: "New member",
            role: "Field Agent",
            branch: "Marina Branch",
            branch_id: "marina",
            boundary: null,
            latest_location: null,
            assignment_fence_id: null,
          },
        ],
        branches: [{ id: "marina", name: "Marina Branch" }],
        enabled: false,
      },
    }),
  );
  await page.goto("/location-tracking");
  await page.getByLabel("View on map").selectOption("member:unassigned");
  await expect(
    page.locator('[aria-label="Selected work boundary"]'),
  ).toContainText("No boundary configured");
  await expect(
    page.locator(".location-monitor-grid .map-radius-label"),
  ).toHaveCount(0);
});

test("a selected member disappears when the scoped refresh removes access", async ({
  page,
}) => {
  await setup(page, { role: "Team Leader", manage: false, read: true });
  let removed = false;
  await page.route("**/api/location-tracking/members?**", (route) =>
    route.fulfill({
      json: {
        items: removed
          ? []
          : [
              {
                user_id: "former-agent",
                name: "Former sales agent",
                role: "Field Agent",
                branch: "Marina Branch",
                branch_id: "marina",
                boundary: {
                  id: "former-circle",
                  name: "Former member boundary",
                  latitude: 25.2,
                  longitude: 55.27,
                  radius_m: 450,
                  enabled: true,
                },
                latest_location: null,
              },
            ],
        branches: [{ id: "marina", name: "Marina Branch" }],
        enabled: false,
      },
    }),
  );
  await page.goto("/location-tracking");
  await page.getByLabel("View on map").selectOption("member:former-agent");
  await expect(
    page.locator('[aria-label="Selected work boundary"]'),
  ).toContainText("Former member boundary");
  removed = true;
  await expect(
    page.locator('[aria-label="Selected work boundary"]'),
  ).not.toContainText("Former member boundary", { timeout: 22000 });
  await expect(
    page.getByRole("heading", {
      name: "Former sales agent's work boundary",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("removed satellite mode never exposes a provider or an external satellite link", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/location-tracking");
  await page.getByText("Search map & view options", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Satellite", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /satellite/i })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Street", exact: true }),
  ).toBeVisible();
  expect(fixture.requests).not.toContain("/api/location-tracking/map-imagery");
});
