import { expect, test, Locator } from "@playwright/test";
import { previewBuild } from "./preview";

test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.RELAY_ALLOW_READONLY_TEST !== "1" ||
      new URL(baseURL!).hostname !== "relay-client.187-127-162-233.sslip.io",
    "Requires explicit read-only hosted evaluation",
  );
});
async function boxes(control: Locator) {
  return control.evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        height: r.height,
        width: r.width,
      };
    }),
  );
}
function alignedOnSameLine(a: any, b: any) {
  if (Math.abs(a.top - b.top) < Math.min(a.height, b.height)) {
    expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.bottom - b.bottom)).toBeLessThanOrEqual(1);
  }
}
for (const width of [1440, 1024, 800, 390]) {
  test(
    "shared control rows and verification columns align at " + width + "px",
    async ({ page }, info) => {
      test.setTimeout(120000);
      const before = process.env.RELAY_RECORD_BEFORE === "1";
      test.skip(
        before && width !== 1440,
        "Record one current-release baseline",
      );
      const errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const p = new URL(r.url()).pathname;
        if (
          p.startsWith("/api/") &&
          !p.startsWith("/api/auth/") &&
          ["POST", "PUT", "PATCH", "DELETE"].includes(r.method())
        )
          writes.push(p);
      });
      await previewBuild(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page
        .getByLabel("Work email", { exact: true })
        .fill("admin@relay.demo");
      await page
        .getByLabel("Password", { exact: true })
        .fill(process.env.DEMO_PASSWORD!);
      await page
        .getByRole("button", { name: "Sign in to workspace", exact: true })
        .click();
      await expect(page.locator("#workspace-content")).toBeVisible({
        timeout: 20000,
      });
      const measurements: any[] = [];
      for (const path of [
        "/location-tracking",
        "/sr-verification",
        "/sales",
        "/kyc-capture",
        "/agents",
        "/reports",
      ]) {
        await page.goto(path);
        await expect(page.locator("#workspace-content").getByRole("heading").first()).toBeVisible(
          { timeout: 20000 },
        );
        await expect(page.locator(".skeleton")).toHaveCount(0, {
          timeout: 20000,
        });
        await expect(
          page.locator("#workspace-content .error-state"),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        if (path === "/location-tracking") {
          const branch = await boxes(
            page.locator(".location-head-actions .branch-filter"),
          );
          const exp = await boxes(
            page.locator(".location-head-actions > button"),
          );
          measurements.push({ path, branch, export: exp });
          if (!before) {
            alignedOnSameLine(branch[0], exp[0]);
            expect(branch[0].height).toBe(44);
            expect(exp[0].height).toBe(44);
          }
          const search = await boxes(
            page.locator(".map-place-search input").first(),
          );
          const searchButton = await boxes(
            page.locator(".map-place-search > button").first(),
          );
          if (!before) alignedOnSameLine(search[0], searchButton[0]);
          const filters = await boxes(
            page.locator(".location-table-filters :is(input,select)"),
          );
          if (!before)
            for (let i = 1; i < filters.length; i++)
              alignedOnSameLine(filters[i - 1], filters[i]);
          await page
            .getByRole("button", { name: "Export locations", exact: true })
            .click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          expect(
            await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(width + "-locations-export-dialog.png"),
          });
          await page.keyboard.press("Escape");
        }
        if (path === "/sr-verification") {
          const fields = await boxes(
            page.locator(".sr-verification > .sales-form input"),
          );
          const action = await boxes(
            page.getByRole("button", { name: "Preview matches", exact: true }),
          );
          measurements.push({ path, fields, action });
          if (!before)
            for (const field of fields) alignedOnSameLine(field, action[0]);
          const comparison = page.locator(".sr-comparison-filters").first();
          const input = await boxes(comparison.locator("input"));
          const buttons = await boxes(comparison.locator("> button"));
          if (!before)
            for (const button of buttons) alignedOnSameLine(input[0], button);
        }
        if (path === "/sales") {
          const period = await boxes(
            page.locator(".sales-toolbar input").first(),
          );
          const controls = await boxes(
            page.locator(".sales-toolbar .export-controls :is(select,button)"),
          );
          if (!before)
            for (const control of controls)
              alignedOnSameLine(period[0], control);
        }
        if (path === "/kyc-capture") {
          const metadata = await boxes(
            page.locator(".review-inbox-list > button > span:nth-child(2)"),
          );
          const arrows = await boxes(
            page.locator(".review-inbox-list > button > b"),
          );
          measurements.push({ path, metadata, arrows });
          expect(metadata.length).toBeGreaterThan(1);
          if (!before) {
            for (const column of metadata)
              expect(
                Math.abs(column.left - metadata[0].left),
              ).toBeLessThanOrEqual(1);
            for (const column of arrows)
              expect(
                Math.abs(column.left - arrows[0].left),
              ).toBeLessThanOrEqual(1);
          }
        }
        if (path === "/agents") {
          const search = await boxes(
            page.locator(".table-tools .search").first(),
          );
          const filter = await boxes(
            page.locator(".table-tools .filter-control select").first(),
          );
          if (!before && search.length && filter.length)
            alignedOnSameLine(search[0], filter[0]);
        }
        await page.screenshot({
          path: info.outputPath(
            width + path.replaceAll("/", "-") + "-full.png",
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
      await info.attach("alignment-measurements", {
        body: JSON.stringify(measurements, null, 2),
        contentType: "application/json",
      });
    },
  );
}
