import { expect, Page, test } from "@playwright/test";
import { authenticate } from "./session";

async function checkDialog(page: Page, label: string, screenshot: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".skeleton")).toHaveCount(0, { timeout: 20000 });
  await expect(dialog.getByRole("heading").first()).toBeVisible();
  await expect
    .poll(
      async () => {
        const box = await dialog.boundingBox();
        return box ? box.x + box.width : Infinity;
      },
      { message: `${label}: drawer entry settles inside the viewport` },
    )
    .toBeLessThanOrEqual((page.viewportSize()?.width || 0) + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    label,
  ).toBe(true);
  const collisions = await dialog
    .locator(
      "input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea",
    )
    .evaluateAll((elements) => {
      const fields = elements
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({
          name:
            el.getAttribute("name") ||
            el.getAttribute("aria-label") ||
            el.closest("label")?.textContent?.trim(),
          rect: el.getBoundingClientRect(),
        }));
      return fields.flatMap((field, index) =>
        fields
          .slice(index + 1)
          .filter(
            (other) =>
              Math.min(field.rect.right, other.rect.right) -
                Math.max(field.rect.left, other.rect.left) >
                2 &&
              Math.min(field.rect.bottom, other.rect.bottom) -
                Math.max(field.rect.top, other.rect.top) >
                2,
          )
          .map((other) => `${field.name} overlaps ${other.name}`),
      );
    });
  expect(collisions, `${label}: form inputs do not overlap`).toEqual([]);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x, `${label}: dialog left`).toBeGreaterThanOrEqual(-1);
  expect(
    bounds!.x + bounds!.width,
    `${label}: dialog right`,
  ).toBeLessThanOrEqual((page.viewportSize()?.width || 0) + 1);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog
    .getByRole("button", { name: "Close details", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    `${label}: focus stays inside`,
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("current record details and add/edit forms stay aligned at desktop and narrow widths", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  await authenticate(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of [
      "agents",
      "branches",
      "customers",
      "inventory",
      "audit",
    ]) {
      await page.goto("/" + route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(
        { timeout: 20000 },
      );
      await expect(page.locator(".record-link").first()).toBeVisible({
        timeout: 20000,
      });
      await page.locator(".record-link").first().click();
      await checkDialog(
        page,
        `${width} ${route} details`,
        info.outputPath(`${width}-${route}-details.png`),
      );
    }
    for (const [route, button] of [
      ["branches", "Add branch"],
      ["agents", "Add sales agent"],
      ["team-leaders", "Manage team leaders"],
      ["plans", "Add plan"],
    ]) {
      await page.goto("/" + route);
      await page.getByRole("button", { name: button, exact: true }).click();
      await checkDialog(
        page,
        `${width} ${button}`,
        info.outputPath(`${width}-${route}-add.png`),
      );
    }
    await page.goto("/plans");
    await page
      .getByRole("button", { name: "Edit plan", exact: true })
      .first()
      .click();
    await checkDialog(
      page,
      `${width} edit plan`,
      info.outputPath(`${width}-plan-edit.png`),
    );
    await page.goto("/team-leaders");
    await page
      .getByRole("button", { name: "Edit team leader", exact: true })
      .first()
      .click();
    await checkDialog(
      page,
      `${width} edit leader`,
      info.outputPath(`${width}-leader-edit.png`),
    );
    await page.goto("/inventory");
    await page
      .getByRole("button", { name: "Import Excel", exact: true })
      .click();
    await checkDialog(
      page,
      `${width} stock import`,
      info.outputPath(`${width}-stock-import.png`),
    );
  }
  expect(errors).toEqual([]);
});
