import { expect, Page, Request, test } from "@playwright/test";
import { previewBuild } from "./preview";

// This suite deliberately opens read-only views. It must remain safe to run
// against the hosted evaluation database as well as the isolated QA service.
const accounts = [
  "admin",
  "ops",
  "cluster",
  "leader",
  "agent1",
  "compliance",
  "inventory",
  "salesmanager",
  "tele",
  "welcome",
];

function watchHealth(page: Page) {
  const errors: string[] = [];
  const pending = new Set<Request>();
  page.on("pageerror", (error) =>
    errors.push(`${new URL(page.url()).pathname}: ${error.message}`),
  );
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && path !== "/api/events/stream")
      pending.add(request);
  });
  const completed = (request: Request) => pending.delete(request);
  page.on("requestfinished", completed);
  page.on("requestfailed", completed);
  page.on("response", (response) => {
    const url = new URL(response.url());
    pending.delete(response.request());
    if (url.pathname.startsWith("/api/") && response.status() >= 500)
      errors.push(`${response.status()} ${url.pathname}`);
  });
  return { errors, pending };
}

async function signIn(page: Page, account: string) {
  if (!process.env.DEMO_PASSWORD)
    throw new Error(
      "Set DEMO_PASSWORD for the hosted or QA evaluation accounts.",
    );
  await previewBuild(page);
  await page.goto("/");
  await page.locator("input[type=email]").fill(`${account}@relay.demo`);
  await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.locator("#workspace-content")).toBeVisible({
    timeout: 20000,
  });
}

async function expectHealthyView(
  page: Page,
  health: ReturnType<typeof watchHealth>,
  label: string,
) {
  const main = page.locator("#workspace-content");
  await expect(main).toBeVisible();
  await expect(main.locator("h1").first(), label).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 15000 });
  await expect
    .poll(
      () =>
        [...health.pending].map((request) => new URL(request.url()).pathname),
      { message: `${label}: data requests finish`, timeout: 15000 },
    )
    .toEqual([]);
  await expect(main.locator(".error-state"), label).toHaveCount(0);
  await expect(
    main.getByRole("heading", {
      name: /This page (couldn.t be displayed|is not available for your role)|Page not included/,
    }),
    label,
  ).toHaveCount(0);
  expect(health.errors, `${label}: browser and API errors`).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `${label}: no whole-page horizontal overflow`,
  ).toBe(true);
  // Opening dozens of full documents in a tight loop otherwise exhausts the
  // evaluation API's shared per-IP limit. This is pacing, not a readiness wait.
  await page.waitForTimeout(
    Number(process.env.RELAY_NAVIGATION_PAUSE_MS || 1500),
  );
}

for (const account of accounts) {
  test(`${account}: every visible navigation destination loads without rendering or server errors`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(account === "admin" ? 240000 : 180000);
    const health = watchHealth(page);
    await signIn(page, account);
    const destinations = await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => ({
          path: link.getAttribute("href")!,
          label: link.textContent!.trim().replace(/\s+/g, " "),
        })),
      );
    expect(destinations.length).toBeGreaterThan(0);
    const visited: string[] = [];
    for (const width of account === "admin" ? [1440, 390] : [1440]) {
      await page.setViewportSize({ width, height: 960 });
      for (const destination of destinations) {
        health.pending.clear(); // A document navigation may abandon the previous view's requests.
        await page.goto(destination.path);
        const label = `${account} / ${width}px / ${destination.label} (${destination.path})`;
        await test.step(label, async () =>
          expectHealthyView(page, health, label),
        );
        visited.push(label);
      }
    }
    await testInfo.attach("read-only-destinations", {
      body: JSON.stringify(visited, null, 2),
      contentType: "application/json",
    });
  });
}

test("administrator: sales, assets, administration and commission subviews remain healthy at both widths", async ({
  page,
}, testInfo) => {
  test.setTimeout(240000);
  const health = watchHealth(page);
  await signIn(page, "admin");
  const visited: string[] = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [path, navigation] of [
      ["/sales", "Sales sections"],
      ["/equipment", "Asset sections"],
      ["/call-work", "Call queue filters"],
    ]) {
      health.pending.clear();
      await page.goto(path);
      await expectHealthyView(page, health, `${width}px ${path}`);
      const tabs = await page
        .getByRole("navigation", { name: navigation })
        .getByRole("button")
        .allTextContents();
      expect(tabs.length).toBeGreaterThan(1);
      for (const tab of tabs) {
        await page
          .getByRole("navigation", { name: navigation })
          .getByRole("button", { name: tab.trim(), exact: true })
          .click();
        const label = `${width}px ${path} / ${tab.trim()}`;
        await test.step(label, async () =>
          expectHealthyView(page, health, label),
        );
        visited.push(label);
      }
    }
    for (const section of [
      "branches",
      "agents",
      "customers",
      "inventory",
      "incentives",
    ]) {
      health.pending.clear();
      await page.goto(`/administration?section=${section}`);
      const label = `${width}px administration / ${section}`;
      await expectHealthyView(page, health, label);
      await expect(
        page.getByRole("textbox", { name: "Search records" }),
      ).toBeVisible();
      visited.push(label);
    }
    health.pending.clear();
    await page.goto("/incentives");
    await expectHealthyView(page, health, `${width}px incentives`);
    const approved = page.locator(".commission-policies");
    await approved.locator(":scope > summary").click();
    const tables = approved.locator(".commission-policy");
    await expect(tables).toHaveCount(4);
    for (const table of await tables.all()) {
      await table.locator(":scope > summary").click();
      await expect(table.locator("h4").first()).toBeVisible();
    }
    await expectHealthyView(
      page,
      health,
      `${width}px all four approved incentive tables`,
    );
    visited.push(`${width}px all four approved incentive tables`);
  }
  await testInfo.attach("read-only-subviews", {
    body: JSON.stringify(visited, null, 2),
    contentType: "application/json",
  });
});
