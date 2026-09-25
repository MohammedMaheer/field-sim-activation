import { test, expect } from "@playwright/test";
import { authenticate } from "./session";
test("setup drawer and detail navigation", async ({ page }) => {
  await authenticate(page);
  await page.goto("/agents");
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  const d = page.getByRole("dialog");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../output/qa/organization-${width}.png`,
      fullPage: false,
      animations: "disabled",
    });
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "View Zayn Mercer", exact: true })
    .click();
  await expect(page).toHaveURL(/selected=/);
  await expect(d).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/selected=/);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(d).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Operations overview" }),
  ).toBeVisible();
  await expect(page.locator(".premium-kpi")).toHaveCount(4);
  await page.screenshot({
    path: "../output/qa/usability-overview.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("create connected branch team outlet and agent", async ({
  page,
  request,
}) => {
  test.skip(!process.env.RELAY_ALLOW_SETUP_TEST, "Isolated QA database only");
  await authenticate(page);
  await page.goto("/team-leaders");
  await page.getByRole("button", { name: "Set up branches & teams" }).click();
  const d = page.getByRole("dialog"),
    suffix = Date.now().toString();
  await d
    .getByLabel("Branch name", { exact: true })
    .fill("Demo setup " + suffix);
  await d.getByRole("button", { name: "Create branch", exact: true }).click();
  await expect(d.getByRole("status")).toContainText("Branch created");
  await d.getByRole("button", { name: "Team", exact: true }).click();
  await d.getByLabel("Team leader name").fill("Demo setup leader");
  await d.getByLabel("Sign-in email").fill("leader." + suffix + "@relay.demo");
  await d.getByLabel("Password", { exact: false }).fill("test-client-password");
  await d.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(d.getByRole("status")).toContainText("Team created");
  await d.getByRole("button", { name: "Outlet", exact: true }).click();
  await d.getByLabel("Outlet name", { exact: true }).fill("Demo setup outlet");
  await d.getByRole("button", { name: "Create outlet", exact: true }).click();
  await expect(d.getByRole("status")).toContainText("Outlet created");
  await d.getByRole("button", { name: "Agent", exact: true }).click();
  await d.getByLabel("Agent name", { exact: true }).fill("Demo setup agent");
  await d
    .getByRole("combobox", { name: "Team", exact: true })
    .selectOption({ label: "Demo setup leader’s team" });
  await d
    .getByRole("combobox", { name: "Outlet", exact: true })
    .selectOption({ label: "Demo setup outlet" });
  await d.getByLabel("Employee ID").fill("QA-" + suffix);
  await d.getByLabel("Sign-in email").fill("agent." + suffix + "@relay.demo");
  await d.getByLabel("Password", { exact: false }).fill("test-client-password");
  await d.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(d.getByRole("status")).toContainText("Agent created");
  const r = await request.post("/api/auth/login", {
    data: {
      email: "agent." + suffix + "@relay.demo",
      password: "test-client-password",
      native: true,
    },
  });
  expect(r.ok()).toBeTruthy();
  const agents = await request.get("/api/resources/agents", {
    headers: { Authorization: "Bearer " + (await r.json()).access_token },
  });
  const rows = await agents.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("Demo setup agent");
});
