import { test, expect } from "@playwright/test";
import { authenticate } from "./session";
test("administrator can navigate network, stock, work and plans without overflow", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/administration");
  const network = page.getByRole("group", { name: "Field network" });
  await network.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await expect(page.getByText("Set up your field network")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("group", { name: "Customer & stock" })
    .getByRole("button", { name: "SIM stock" })
    .click();
  await expect(
    page.getByRole("heading", { name: "SIM stock", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Daily work" })
    .getByRole("button", { name: "Tasks" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../output/qa/admin-navigation-390.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Subscriber plans →", exact: true })
    .click();
  await expect(page).toHaveURL(/plans$/);
});
