import { expect, Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function workspace(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    const data =
      path === "/api/auth/refresh"
        ? {
            access_token: "synthetic-export-token",
            user: {
              id: "export-user",
              name: "Export reviewer",
              role: "Administrator",
              permissions: ["read", "report.read", "audit.read"],
            },
          }
        : path === "/api/notifications"
          ? { items: [], unread: 0 }
          : path === "/api/resources/branches"
            ? [{ id: "branch-q", name: "Marina Branch" }]
            : [];
    await route.fulfill({ json: data });
  });
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reports & exports" }),
  ).toBeVisible();
  await page.getByLabel("Report type", { exact: true }).selectOption("daily");
  await page.getByLabel("Download report format").selectOption("csv");
}

test("Qanawat reports download all formats with the shared branch and date filters", async ({
  page,
}) => {
  await workspace(page);
  await expect(
    page.locator(".sidebar img[alt='Qanawat Connect Solutions LLC']"),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("branch-q");
  await page.getByLabel("From date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-11");
  await page.getByPlaceholder("Sales agent, branch, reference…").fill("Zayn");
  const report = page.locator(".report-download");
  for (const format of ["xlsx", "csv", "pdf"]) {
    let query: URLSearchParams | undefined;
    const content =
      format === "pdf"
        ? "%PDF-1.4\nQanawat"
        : format === "xlsx"
          ? "PK\u0003\u0004Qanawat"
          : "SR number,Phone\r\nSR-001,0500000000\r\n";
    await page.route("**/api/reports/daily?**", async (route) => {
      query = new URL(route.request().url()).searchParams;
      await route.fulfill({
        contentType:
          format === "pdf"
            ? "application/pdf"
            : format === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "text/csv;charset=utf-8",
        headers: {
          "Content-Disposition": `attachment; filename="qanawat-daily-2026-10-01-2026-10-11.${format}"`,
        },
        body: content,
      });
    });
    const downloaded = page.waitForEvent("download");
    await report.getByLabel("Download report format").selectOption(format);
    await report
      .getByRole("button", { name: "Download report", exact: true })
      .click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe(
      `qanawat-daily-2026-10-01-2026-10-11.${format}`,
    );
    expect((await readFile((await file.path())!)).toString()).toBe(content);
    expect(query?.get("branch_id")).toBe("branch-q");
    expect(query?.get("start")).toBe("2026-10-01");
    expect(query?.get("end")).toBe("2026-10-11");
    expect(query?.get("q")).toBe("Zayn");
    await page.unroute("**/api/reports/daily?**");
  }
});

test("failed export is explained and can be retried without a stuck loading state", async ({
  page,
}) => {
  await workspace(page);
  const report = page.locator(".report-download");
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: "Your export access was removed. Refresh your role." },
    }),
  );
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your export access was removed" }),
  ).toBeVisible();
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".export-progress")).toHaveCount(0);
  await page.unroute("**/api/reports/daily?**");
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "SR,Status\nSR-001,Closed\n",
    }),
  );
  const downloaded = page.waitForEvent("download");
  await report.getByLabel("Download report format").selectOption("csv");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /^qanawat-daily-.*\.csv$/,
  );
});

test("exports recover an expired token once and reject an empty file", async ({
  page,
}) => {
  await workspace(page);
  const report = page.locator(".report-download");
  let requests = 0;
  await page.route("**/api/reports/daily?**", async (route) => {
    requests += 1;
    await route.fulfill(
      requests === 1
        ? { status: 401, json: { detail: "Expired" } }
        : { contentType: "application/pdf", body: "" },
    );
  });
  await report.getByLabel("Download report format").selectOption("pdf");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "This export is empty" }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeEnabled();
});

test("reports reject missing and inverted dates before any download request", async ({
  page,
}) => {
  await workspace(page);
  let requests = 0;
  await page.route("**/api/reports/**", (route) => {
    requests++;
    return route.fulfill({ contentType: "text/csv", body: "SR,Status\n" });
  });
  const report = page.locator(".report-download");
  await page.getByLabel("From date", { exact: true }).fill("2026-10-13");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-12");
  await expect(page.getByRole("alert")).toContainText("on or after");
  await expect(report.getByLabel("Download report format")).toBeDisabled();
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("To date", { exact: true }).fill("");
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(0);
  await page.getByLabel("To date", { exact: true }).fill("2026-10-13");
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeEnabled();
});

test("an export rejected after token refresh returns to sign-in instead of retaining stale access", async ({
  page,
}) => {
  await workspace(page);
  let requests = 0;
  await page.route("**/api/reports/daily?**", (route) => {
    requests++;
    return route.fulfill({ status: 401, json: { detail: "Session revoked" } });
  });
  const report = page.locator(".report-download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
  await expect(page.locator(".export-progress")).toHaveCount(0);
});

test("an HTML response and a disconnected export never download bogus files and can be retried", async ({
  page,
}) => {
  await workspace(page);
  const report = page.locator(".report-download");
  const files: string[] = [];
  page.on("download", (file) => files.push(file.suggestedFilename()));
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html>Sign in</html>" }),
  );
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "did not return an export" }),
  ).toBeVisible();
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/reports/daily?**");
  await page.route("**/api/reports/daily?**", (route) =>
    route.abort("internetdisconnected"),
  );
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Failed to fetch" }),
  ).toBeVisible();
  await expect(
    report.getByRole("button", { name: "Download report", exact: true }),
  ).toBeEnabled();
  expect(files).toEqual([]);
  await page.unroute("**/api/reports/daily?**");
  await page.route("**/api/reports/daily?**", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "SR,Status\nSR-001,Closed\n",
    }),
  );
  const downloaded = page.waitForEvent("download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toMatch(
    /^qanawat-daily-.*\.csv$/,
  );
});

test("a slow export blocks repeated clicks and restores every report control after completion", async ({
  page,
}) => {
  await workspace(page);
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  let requests = 0;
  await page.route("**/api/reports/daily?**", async (route) => {
    requests++;
    await wait;
    await route.fulfill({
      contentType: "text/csv",
      body: "SR,Status\nSR-001,Closed\n",
    });
  });
  const report = page.locator(".report-download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .dblclick();
  await expect(
    report.getByRole("button", { name: "Preparing…", exact: true }),
  ).toBeDisabled();
  for (const button of await report.locator("button").all())
    await expect(button).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  const downloaded = page.waitForEvent("download");
  release();
  await downloaded;
  for (const button of await report.locator("button").all())
    await expect(button).toBeEnabled();
  expect(requests).toBe(1);
});

test("offline sign-out clears the portal and cannot be undone by reload", async ({
  page,
}) => {
  await workspace(page);
  await page.route("**/api/auth/logout", (route) => route.abort("failed"));
  await page.getByRole("button", { name: /Export reviewer/ }).click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  let refreshes = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/auth/refresh") refreshes++;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  expect(refreshes).toBe(0);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
});

test("temporary session renewal failure keeps the signed-in workspace and export can retry", async ({
  page,
}) => {
  await workspace(page);
  let requests = 0,
    ready = false;
  await page.route("**/api/reports/daily?**", (route) => {
    requests++;
    return ready
      ? route.fulfill({
          contentType: "text/csv",
          body: "name,value\nsynthetic,1\n",
          headers: {
            "Content-Disposition": 'attachment; filename="qanawat-retry.csv"',
          },
        })
      : route.fulfill({ status: 401, json: { detail: "Expired access" } });
  });
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ status: 503, json: { detail: "Temporary outage" } }),
  );
  const report = page.locator(".report-download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Session renewal is temporarily unavailable. Retry shortly.")
      .first(),
  ).toBeVisible();
  ready = true;
  const downloaded = page.waitForEvent("download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("qanawat-retry.csv");
  expect(requests).toBe(2);
});

test("a late renewal cannot restore the previous account after sign-out and a new sign-in", async ({
  page,
}) => {
  await workspace(page);
  let release!: () => void;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  let renewalStarted = false;
  await page.route("**/api/auth/refresh", async (route) => {
    renewalStarted = true;
    await waiting;
    await route
      .fulfill({
        json: {
          access_token: "previous-account-token",
          user: {
            id: "previous-account",
            name: "Previous account",
            role: "Administrator",
            permissions: ["read", "report.read"],
          },
        },
      })
      .catch(() => {
        /* Sign-out aborts this previous request. */
      });
  });
  const tokens: string[] = [];
  await page.route("**/api/reports/daily?**", (route) => {
    const token = route.request().headers().authorization;
    tokens.push(token);
    return token === "Bearer next-account-token"
      ? route.fulfill({
          contentType: "text/csv",
          body: "name,value\nnew account,1\n",
        })
      : route.fulfill({ status: 401, json: { detail: "Expired" } });
  });
  const report = page.locator(".report-download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await expect.poll(() => renewalStarted).toBe(true);
  await page.getByRole("button", { name: /Export reviewer/ }).click();
  await expect(
    page.getByRole("button", { name: "Sign in to workspace", exact: true }),
  ).toBeVisible();
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: {
        access_token: "next-account-token",
        user: {
          id: "next-account",
          name: "Next account",
          role: "Administrator",
          permissions: ["read", "report.read", "audit.read"],
        },
      },
    }),
  );
  await page.locator("input[type=email]").fill("next@example.test");
  await page.locator("input[type=password]").fill("synthetic-password");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Next account/ }),
  ).toBeVisible();
  release();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByLabel("Report type", { exact: true }).selectOption("daily");
  await page.getByLabel("Download report format").selectOption("csv");
  const downloaded = page.waitForEvent("download");
  await report
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  await downloaded;
  expect(tokens).toEqual([
    "Bearer synthetic-export-token",
    "Bearer next-account-token",
  ]);
  await expect(
    page.getByRole("button", { name: /Next account/ }),
  ).toBeVisible();
  await expect(page.getByText("Previous account", { exact: true })).toHaveCount(
    0,
  );
});

test("narrow navigation sign-out restores login scrolling and the next account starts with its menu closed", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await workspace(page);
  await page.route("**/api/auth/logout", (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await expect(page.locator(".sidebar.open")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await page.locator(".profile-button").click();
  const signIn = page.getByRole("button", {
    name: "Sign in to workspace",
    exact: true,
  });
  await expect(signIn).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  await signIn.scrollIntoViewIfNeeded();
  await expect(signIn).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("390-login-scroll-restored.png"),
    animations: "disabled",
  });
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: {
        access_token: "next-narrow-account-token",
        user: {
          id: "next-narrow-account",
          name: "Next narrow account",
          role: "Administrator",
          permissions: ["read", "report.read", "audit.read"],
        },
      },
    }),
  );
  await page
    .getByLabel("Work email", { exact: true })
    .fill("next-narrow@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await signIn.click();
  await expect(
    page.getByRole("heading", { name: "Reports & exports", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Toggle navigation", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
});

test("expired authentication with navigation open restores a scrollable sign-in screen", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 600 });
  await workspace(page);
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await expect(page.locator(".sidebar.open")).toHaveCount(1);
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ status: 401, json: { detail: "Session revoked" } }),
  );
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { detail: "Session revoked" } }),
  );
  // The normal notification refresh encounters the revoked session while the menu is open.
  const signIn = page.getByRole("button", {
    name: "Sign in to workspace",
    exact: true,
  });
  await expect(signIn).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  await signIn.scrollIntoViewIfNeeded();
  await expect(signIn).toBeInViewport();
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("390-expired-session-scroll-restored.png"),
    animations: "disabled",
  });
});
