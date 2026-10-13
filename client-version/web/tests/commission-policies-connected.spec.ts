import { expect, test } from "@playwright/test";

test.beforeEach(({ baseURL }) => {
  const host = new URL(baseURL || "http://invalid").hostname;
  const isolated = process.env.RELAY_ALLOW_SETUP_TEST === "1" && ["localhost", "127.0.0.1"].includes(host);
  const hosted = process.env.RELAY_ALLOW_READONLY_TEST === "1" && host === "relay-client.187-127-162-233.sslip.io";
  test.skip(
    !isolated && !hosted,
    "Requires explicitly selected isolated QA or read-only hosted evaluation",
  );
});

for (const width of [1440, 390]) {
  test(`all four approved commission policies preserve local table scrolling at ${width}px`, async ({
    page,
  }, info) => {
    const failures: string[] = [],
      mutations: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith("/api/") &&
        !path.startsWith("/api/auth/") &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
      )
        mutations.push(`${request.method()} ${path}`);
    });
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/incentives");
    await page
      .getByLabel("Work email", { exact: true })
      .fill("admin@relay.demo");
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.DEMO_PASSWORD!);
    await page
      .getByRole("button", { name: "Sign in to workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Incentives", exact: true }),
    ).toBeVisible();
    await page
      .getByText("Calculated estimates and commission setup", { exact: true })
      .click();
    await page.locator(".commission-policies > summary").click();
    const policies = page.locator(".commission-policy");
    await expect(policies).toHaveCount(4);
    for (const policy of await policies.all())
      await policy.locator(":scope > summary").click();
    await expect(page.locator(".commission-policy[open]")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    for (const container of await page
      .locator(
        ".incentive-recorded-history,.commission-policies,.commission-policy",
      )
      .all()) {
      const bounds = await container.boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
    const tables = page.locator(".commission-policy .sales-table-wrap");
    expect(await tables.count()).toBeGreaterThanOrEqual(4);
    for (const table of await tables.all()) {
      const bounds = await table.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      if (width === 390) {
        const result = await table.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
          return {
            scrollLeft: element.scrollLeft,
            content: element.scrollWidth,
            visible: element.clientWidth,
          };
        });
        expect(result.content).toBeGreaterThan(result.visible);
        expect(result.scrollLeft).toBeGreaterThan(0);
        await table.evaluate((element) => {
          element.scrollLeft = 0;
        });
      }
    }
    let index = 0;
    for (const policy of await policies.all()) {
      await policy.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`${width}-approved-policy-${++index}.png`),
        animations: "disabled",
      });
    }
    await expect(page.locator(".error-state")).toHaveCount(0);
    expect(failures).toEqual([]);
    expect(mutations).toEqual([]);
  });
}
