import { expect, Page, test } from "@playwright/test";

type Notice = {
  id: string;
  category: string;
  title: string;
  message: string;
  created_at: string;
  web_path: string;
  read: boolean;
};
const notice = (id: string, category = "Transactions", read = false): Notice => ({
  id,
  category,
  title: `${id} update`,
  message: "The saved sale has been reviewed.",
  created_at: "2026-10-13T08:00:00",
  web_path: "/sales?selected=sale-one",
  read,
});

async function inbox(page: Page, rows: Notice[], options: { reject?: boolean } = {}) {
  const writes: string[][] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path === "/api/auth/refresh")
      return route.fulfill({ json: {
        access_token: "notification-edge-test",
        user: { id: "edge-agent", name: "Sales agent", role: "Field Agent", agent_id: "agent-one", permissions: ["read", "ekyc.write"] },
      } });
    if (path === "/api/notifications/read") {
      const body = route.request().postDataJSON();
      writes.push(body.ids);
      if (options.reject)
        return route.fulfill({ status: 409, json: { detail: "The notification changed. Refresh and retry." } });
      for (const row of rows)
        if (body.ids.includes(row.id)) row.read = body.read;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/notifications")
      return route.fulfill({ json: {
        categories: ["Transactions", "Stock", "Support", "Workspace"],
        items: rows,
        unread: rows.filter((row) => !row.read).length,
      } });
    if (path === "/api/sales-management/performance")
      return route.fulfill({ json: { recorded: 0, closed: 0, by_product: {}, daily_by_product: {}, daily_summary: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: /^Notifications/ })).toBeVisible();
  return writes;
}

test("notification center hides forbidden routes, external links and unauthorized categories", async ({ page }) => {
  const rows = [
    notice("visible"),
    { ...notice("admin-only"), web_path: "/plans" },
    { ...notice("external"), web_path: "https://example.test" },
    { ...notice("protocol-relative"), web_path: "//example.test" },
    notice("call-role-only", "Calls"),
  ];
  await inbox(page, rows);
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await expect(page.locator(".notification-row")).toContainText("visible update");
  await expect(page.getByRole("group", { name: "Notification categories" }).getByRole("button", { name: /^Calls/ })).toHaveCount(0);
});

test("mark shown as read respects category, search and unread filters and preserves hidden records", async ({ page }) => {
  const rows = [notice("matching"), notice("other"), notice("stock", "Stock"), notice("already-read", "Transactions", true)];
  const writes = await inbox(page, rows);
  await page.getByRole("group", { name: "Notification categories" }).getByRole("button", { name: /^Transactions/ }).click();
  await page.getByRole("textbox", { name: "Search notifications" }).fill("matching");
  await page.getByRole("checkbox", { name: "Unread only" }).check();
  await expect(page.locator(".notification-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Mark shown as read", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You’re all caught up" })).toBeVisible();
  expect(writes).toEqual([["matching"]]);
  expect(rows.find((row) => row.id === "other")?.read).toBe(false);
  expect(rows.find((row) => row.id === "stock")?.read).toBe(false);
  await expect(page.getByRole("button", { name: "Mark shown as read", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Unread only" }).uncheck();
  await expect(page.locator(".notification-row.is-read")).toHaveCount(1);
});

test("failed read update keeps the record visible and does not navigate until retry succeeds", async ({ page }) => {
  const options = { reject: true };
  const rows = [notice("retry")];
  const writes = await inbox(page, rows, options);
  await page.locator(".notification-open").click();
  await expect(page.getByRole("alert")).toContainText("Refresh and retry");
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.locator(".notification-row.is-unread")).toHaveCount(1);
  await expect(page.locator(".notification-open")).toBeEnabled();
  options.reject = false;
  await page.locator(".notification-open").click();
  await expect(page).toHaveURL(/\/sales\?selected=sale-one$/);
  expect(writes).toEqual([["retry"], ["retry"]]);
  expect(rows[0].read).toBe(true);
});

test("notification timestamps accept both timezone offsets and legacy UTC values", async ({ page }) => {
  await inbox(page, [
    notice("legacy"),
    { ...notice("offset"), created_at: "2026-10-13T12:00:00+04:00" },
  ]);
  for (const row of await page.locator(".notification-row").all()) {
    await expect(row.locator("time")).not.toContainText("Invalid Date");
  }
  expect(await page.locator(".notification-row time").allTextContents()).toEqual([
    await page.locator(".notification-row time").first().innerText(),
    await page.locator(".notification-row time").first().innerText(),
  ]);
});

test("missing or malformed notification dates remain explicitly unrecorded", async ({ page }) => {
  await inbox(page, [
    { ...notice("missing"), created_at: "" },
    { ...notice("malformed"), created_at: "not-a-date" },
  ]);
  await expect(page.locator(".notification-row time")).toHaveText([
    "Not recorded",
    "Not recorded",
  ]);
});
