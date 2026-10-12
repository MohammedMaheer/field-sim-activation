import { expect, test } from "@playwright/test";
import { mobileSignIn } from "./mobile-session";

const titles: Record<string, string> = {
  notifications: "Notifications",
  "sales-management": "Sales management",
  records: "Historical activations",
  transactions: "Transactions",
  stock: "Inventory",
  customers: "Customers",
  incentives: "My incentives",
  assets: "Assets & supplies",
  support: "Support",
  reports: "Reports",
  drafts: "Drafts",
  "call-work": "Call work queue",
};
const field = [
  "notifications",
  "sales-management",
  "records",
  "transactions",
  "stock",
  "customers",
  "incentives",
  "assets",
  "support",
];
const accounts: Record<string, string[]> = {
  agent1: [...field, "drafts"],
  leader: [...field, "reports"],
  admin: [...field, "reports", "call-work"],
  ops: [...field, "reports", "drafts", "call-work"],
  salesmanager: [
    "notifications",
    "sales-management",
    "records",
    "transactions",
    "stock",
    "customers",
    "incentives",
    "assets",
    "reports",
  ],
  inventory: [
    "notifications",
    "sales-management",
    "records",
    "stock",
    "customers",
    "incentives",
    "assets",
    "support",
    "reports",
  ],
  compliance: [
    "notifications",
    "sales-management",
    "records",
    "transactions",
    "customers",
    "reports",
    "call-work",
  ],
  tele: ["notifications", "call-work"],
  welcome: ["notifications", "call-work"],
};

for (const [account, paths] of Object.entries(accounts)) {
  test(`${account}: every current mobile page loads with a stable role workspace`, async ({
    page,
  }, info) => {
    test.setTimeout(240000);
    const errors: string[] = [],
      server: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        /RenderFlex|A RenderBox was not laid out|BoxConstraints forces|Another exception was thrown/.test(
          message.text(),
        )
      )
        errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500)
        server.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await mobileSignIn(page, `${account}@relay.demo`);
    const visited: string[] = [];
    for (const path of paths) {
      await page.goto(process.env.MOBILE_PREVIEW_URL + "#/" + path);
      await expect(
        page.getByText(titles[path], { exact: true }).first(),
        `${account} ${path} title`,
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Sign in to Qanawat", exact: true }),
      ).toHaveCount(0);
      await expect.poll(() => page.url()).toContain("#/" + path);
      await page.waitForTimeout(650);
      const retry = page.getByText(
        /Could not load|Couldn.t load|Please retry|Session expired|not available for your role/i,
      );
      await expect(retry, `${account} ${path}: no error state`).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${account} ${path} wrapper overflow`,
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${account}-${path}-390.png`),
        animations: "disabled",
      });
      visited.push(path);
    }
    expect(errors, `${account}: no rendering or layout exceptions`).toEqual([]);
    expect(server, `${account}: no server failures`).toEqual([]);
    await info.attach("mobile-visited-paths", {
      body: JSON.stringify(visited),
      contentType: "application/json",
    });
  });
}
