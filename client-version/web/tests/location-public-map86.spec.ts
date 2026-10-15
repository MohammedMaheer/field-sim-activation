import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { setup } from "./location-fixture";

test("real street-map style and vector tiles load with visible saved radius", async ({
  page,
}) => {
  test.skip(
    process.env.RELAY_MAP_LIVE !== "1",
    "Opt-in external public map verification only",
  );
  await setup(page);
  await page.unroute("https://tiles.openfreemap.org/**");
  const loaded: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    if (response.url().includes("tiles.openfreemap.org"))
      loaded.push({ url: response.url(), status: response.status() });
  });
  await page.goto("/location-tracking");
  await expect(page.locator(".work-map canvas")).toBeVisible();
  await expect
    .poll(
      () =>
        loaded.filter(
          (r) => r.status === 200 && /\.(?:pbf|mvt)(?:\?|$)/.test(r.url),
        ).length,
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  expect(
    loaded.some((r) => r.status === 200 && r.url.includes("/styles/bright")),
  ).toBe(true);
  await expect(page.locator(".work-map")).not.toContainText(
    "Some map tiles could not load",
  );
  await page.waitForTimeout(1500);
  fs.writeFileSync(
    path.resolve("../output/qa/geofence86-public-map-responses.json"),
    JSON.stringify(loaded, null, 2),
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.resolve("../output/qa/geofence86-real-street-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page.getByRole("button", { name: "Add boundary", exact: true }).click();
  await page.getByText("Enter coordinates manually", { exact: true }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("25.2");
  await page.getByLabel("Longitude", { exact: true }).fill("55.27");
  await page.getByRole("button", { name: "500 m", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator(".work-map canvas"),
  ).toBeVisible();
  await page.getByRole("dialog").locator(".work-map").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: path.resolve("../output/qa/geofence86-real-street-editor.png"),
  });
  await test
    .info()
    .attach("External map responses", {
      body: JSON.stringify(loaded),
      contentType: "application/json",
    });
});
