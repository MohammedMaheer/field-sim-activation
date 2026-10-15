import { expect, test } from "@playwright/test";
import path from "node:path";
import { setup, fence, branches } from "./location-fixture";

test("administrator sets boundary by map, controls radius and assigns without changing branch", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/location-tracking");
  await expect(
    page.getByRole("heading", { name: "Locations & work boundaries" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page.getByRole("button", { name: "Add boundary", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Boundary name").fill("Garden worksite");
  await expect(dialog.locator("canvas")).toBeVisible();
  await dialog.locator("canvas").click({ position: { x: 120, y: 100 } });
  await expect(dialog.getByLabel("Latitude", { exact: true })).not.toHaveValue(
    "",
  );
  await dialog.getByLabel("Boundary radius slider").fill("350");
  await dialog
    .getByRole("button", { name: "Save boundary", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = fixture.writes.find(
    (write) => write.path === "/api/location-tracking/fences",
  );
  expect(saved?.body.radius_m).toBe(350);
  expect(saved?.body.branch_id).toBeNull();
  expect(saved?.body.latitude).toBeGreaterThan(-85);
  await page
    .getByRole("button", { name: "Assign boundary for Jordan Vale" })
    .click();
  await page.getByRole("radio", { name: /Use another saved worksite/ }).check();
  await page
    .getByRole("dialog")
    .getByLabel("Boundary assignment")
    .selectOption(fence.id);
  await page.getByRole("button", { name: "Save boundary assignment" }).click();
  expect(
    fixture.writes.find((write) =>
      write.path.endsWith("assignments/sales-agent"),
    )?.body,
  ).toEqual({ fence_id: fence.id });
  expect(
    fixture.writes.some((write) => write.path.includes("/administration/")),
  ).toBe(false);
});

test("all-member explicit tracking starts from device GPS, survives navigation and ends", async ({
  page,
}) => {
  const fixture = await setup(page, {
    role: "Tele Verification Officer",
    manage: false,
    read: false,
  });
  await page.goto("/location-tracking");
  await expect(
    page.getByRole("heading", { name: "My work location" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Work boundaries" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Member work locations" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Start work tracking" }).click();
  await expect(
    page.getByRole("button", { name: "End work tracking" }),
  ).toBeVisible();
  const started = fixture.writes.find((write) =>
    write.path.endsWith("/start"),
  )?.body;
  expect(started.latitude).toBe(25.2);
  expect(started.accuracy_m).toBe(5);
  expect(started.mocked).toBe(false);
  await page.getByRole("link", { name: "Call work queue" }).click();
  await expect(
    page.getByText("Work location tracking on", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View or end tracking" }).click();
  await page.getByRole("button", { name: "End work tracking" }).click();
  await expect(
    page.getByRole("button", { name: "Start work tracking" }),
  ).toBeVisible();
  expect(
    fixture.writes.find((write) => write.path.endsWith("/end"))?.body,
  ).toEqual({ session_id: "work-1" });
});

test("outside and denied-location feedback blocks work without fabricating a position", async ({
  page,
}) => {
  const fixture = await setup(page, {
    enabled: true,
    outside: true,
    role: "Field Agent",
    manage: false,
    read: false,
  });
  await page.goto("/location-tracking");
  await page.getByRole("button", { name: "Start work tracking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Starting work is blocked outside your assigned boundary",
  );
  await expect(
    page.getByRole("button", { name: "End work tracking" }),
  ).toHaveCount(0);
  expect(
    fixture.writes.filter((write) => write.path.endsWith("/start")),
  ).toHaveLength(1);
});

test("outside capture is blocked before the uploaded customer image reaches OCR", async ({
  page,
}) => {
  const fixture = await setup(page, {
    enabled: true,
    outside: true,
    session: true,
    role: "Field Agent",
    manage: false,
    read: false,
  });
  await page.goto("/kyc-capture");
  await expect(
    page.getByText(
      "Capturing a sale is blocked outside your assigned boundary.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/transaction-sample.png"));
  await expect(page.getByRole("alert")).toContainText(
    "Capturing a sale is blocked outside your assigned boundary",
  );
  expect(
    fixture.requests.filter(
      (request) => request === "/api/kyc-captures/ocr-jobs",
    ),
  ).toHaveLength(0);
});

test("scoped view has no management writes, shared branch filter and map stay stable", async ({
  page,
}) => {
  const fixture = await setup(page, {
    role: "Sales Manager",
    manage: false,
    read: true,
    session: true,
  });
  await page.goto("/location-tracking");
  await expect(
    page.getByRole("heading", { name: "Member work locations" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add boundary" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /Assign boundary for/ }),
  ).toHaveCount(0);
  const canvas = page.locator(".work-map canvas").first();
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) =>
    element.setAttribute("data-survives-update", "true"),
  );
  await page.locator(".own-work-disclosure > summary").click();
  await page.getByRole("button", { name: "Update my location" }).click();
  await expect(canvas).toHaveAttribute("data-survives-update", "true");
  await page
    .getByLabel("Branch", { exact: true })
    .last()
    .selectOption("downtown");
  await expect(
    page.getByRole("cell", {
      name: "Mira Rowan Team Leader · Downtown Branch",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "Jordan Vale Sales agent · Marina Branch",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(fixture.requests).toContain("/api/location-tracking/fences");
  expect(
    fixture.writes.filter(
      (write) =>
        write.path.includes("/fences") || write.path.includes("/assignments"),
    ),
  ).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await expect(
    page.getByRole("heading", { name: "Locations & work boundaries" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("../output/qa/geofence-web-manager-narrow.png"),
    fullPage: true,
  });
});

test("export accepts a map or typed radius and includes the role and branch scoped filters", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/location-tracking");
  await page.getByRole("button", { name: "Export locations" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("From date")).not.toHaveValue("");
  await dialog
    .getByRole("combobox", { name: "Member", exact: true })
    .selectOption("sales-agent");
  await dialog.getByLabel("Limit export to a geographic radius").check();
  await dialog.getByLabel("Center latitude").fill("25.2");
  await dialog.getByLabel("Center longitude").fill("55.27");
  await dialog.getByLabel("Export radius slider").fill("1000");
  const [request, downloaded] = await Promise.all([
    page.waitForRequest((request) =>
      request.url().includes("/location-tracking/export"),
    ),
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "CSV", exact: true }).click(),
  ]);
  const query = new URL(request.url()).searchParams;
  expect(query.get("user_id")).toBe("sales-agent");
  expect(query.get("radius_m")).toBe("1000");
  expect(query.get("latitude")).toBe("25.2");
  expect(downloaded.suggestedFilename()).toBe("qanawat-work-locations.csv");
});

test("street and 3D maps remain available without the removed satellite provider", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto("/location-tracking");
  await expect(
    page.getByRole("button", { name: "Satellite", exact: true }),
  ).toHaveCount(0);
  await page.getByText("Search map & view options", { exact: true }).click();
  await page.getByRole("button", { name: "3D buildings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "3D buildings", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(fixture.requests).not.toContain("/api/location-tracking/map-imagery");
  await page.screenshot({
    path: path.resolve("../output/qa/geofence86-live-desktop.png"),
    fullPage: true,
  });
});

test("ending work while GPS is resolving stops the pending point from being recorded", async ({
  page,
}) => {
  const fixture = await setup(page, {
    role: "Field Agent",
    manage: false,
    read: false,
    session: true,
  });
  await page.addInitScript(() => {
    (window as any).pendingGPS = null;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: any) => {
          (window as any).pendingGPS = success;
        },
      },
    });
  });
  await page.goto("/location-tracking");
  await page.getByRole("button", { name: "Update my location" }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).pendingGPS))
    .toBe(true);
  await page.getByRole("button", { name: "End work tracking" }).click();
  await expect(
    page.getByRole("button", { name: "Start work tracking" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).pendingGPS({
      coords: { latitude: 25.2, longitude: 55.27, accuracy: 5 },
      timestamp: Date.now(),
    }),
  );
  await expect
    .poll(
      () =>
        fixture.writes.filter((write) => write.path.endsWith("/points")).length,
    )
    .toBe(0);
});

test("signing out while GPS is resolving stops a pending session start", async ({
  page,
}) => {
  const fixture = await setup(page, {
    role: "Field Agent",
    manage: false,
    read: false,
  });
  await page.addInitScript(() => {
    (window as any).pendingGPS = null;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: any) => {
          (window as any).pendingGPS = success;
        },
      },
    });
  });
  await page.goto("/location-tracking");
  await page.getByRole("button", { name: "Start work tracking" }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).pendingGPS))
    .toBe(true);
  await page.getByTitle("Sign out", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).pendingGPS({
      coords: { latitude: 25.2, longitude: 55.27, accuracy: 5 },
      timestamp: Date.now(),
    }),
  );
  expect(
    fixture.writes.filter((write) => write.path.endsWith("/start")),
  ).toHaveLength(0);
});
