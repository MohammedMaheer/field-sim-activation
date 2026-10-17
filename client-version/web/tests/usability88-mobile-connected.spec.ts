import { expect, test } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";

test("team leader can use grouped navigation, report shortcuts and separate stock requests", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/") &&
      !path.startsWith("/api/auth/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    )
      writes.push(path);
  });
  await mobileSignIn(page, "leader@relay.demo");
  const preview = process.env.MOBILE_PREVIEW_URL!;
  await page.goto(new URL("#/sales-management", preview).toString());
  await page
    .getByRole("button", { name: "Workspace pages", exact: true })
    .click();
  await expect(
    page.getByText("Sales & customers", { exact: true }),
  ).toBeVisible();
  const reports = page.getByRole("button", {
    name: "Choose dates and download reports Reports",
    exact: true,
  });
  const phone = await page.locator("#flutter-host").boundingBox();
  if (!phone) throw new Error("Phone preview is not visible");
  await page.mouse.move(
    phone.x + phone.width / 2,
    phone.y + phone.height * 0.7,
  );
  for (
    let attempt = 0;
    attempt < 8 && !(await reports.isVisible());
    attempt++
  ) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(150);
  }
  await reports.click();
  await expect(
    page.getByRole("checkbox", { name: "Today", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "This month", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^From \d{4}-\d{2}-01$/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("leader-reports.png"),
    fullPage: true,
  });
  await page.goto(new URL("#/assets", preview).toString());
  await expect(page.getByText("Branch assets", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page.getByText("Branch assets", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("leader-stock-requests.png"),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
