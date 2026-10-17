import { expect, Page, test } from "@playwright/test";

async function setup(page: Page) {
  const writes: { path: string; body: any }[] = [];
  let release: (() => void) | undefined;
  let hold = false;
  let rejectNext = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (request.method() === "POST" && !path.startsWith("/api/auth/")) {
      writes.push({ path, body: request.postDataJSON() });
      if (rejectNext) {
        rejectNext = false;
        return route.fulfill({
          status: 422,
          json: { detail: "Correct the report and try again." },
        });
      }
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return route.fulfill({
        json:
          path === "/api/inventory/bulk"
            ? { imported: 2, branch: "Marina Branch" }
            : {
                changes: [],
                summary: {},
                errors: [],
                preview_token: "checked-file",
                applied: !!request.postDataJSON().apply,
              },
      });
    }
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "isolated-import-review",
        user: {
          id: "import-reviewer",
          name: "Import reviewer",
          role: "Administrator",
          permissions: [
            "read",
            "inventory.write",
            "compliance.write",
            "report.read",
          ],
        },
      };
    else if (path === "/api/resources/branches")
      data = [
        { id: "marina", name: "Marina Branch" },
        { id: "downtown", name: "Downtown Branch" },
      ];
    else if (path === "/api/notifications") data = { items: [], unread: 0 };
    else if (path.endsWith("/sr/results")) data = { items: [], summary: {} };
    else if (path.endsWith("/sr/email-status")) data = { configured: false };
    await route.fulfill({ json: data });
  });
  return {
    writes,
    rejectNext() {
      rejectNext = true;
    },
    hold() {
      hold = true;
    },
    release() {
      hold = false;
      release?.();
    },
  };
}

async function inventory(page: Page) {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Import SIM stock",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("marina");
  await dialog.getByLabel("Excel file", { exact: true }).setInputFiles({
    name: "stock.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("synthetic stock upload"),
  });
  await dialog.getByLabel("Reason for stock addition").fill("New branch stock");
  return dialog;
}

test("SIM import resets the native file picker after success and receiving-branch changes", async ({
  page,
}, info) => {
  await setup(page);
  const dialog = await inventory(page),
    file = dialog.getByLabel("Excel file", { exact: true });
  await dialog
    .getByRole("button", { name: "Import stock", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("2 SIMs added");
  await expect(file).toHaveValue("");
  await page.screenshot({
    path: info.outputPath("sim-import-success-desktop.png"),
  });
  await file.setInputFiles({
    name: "next.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("next upload"),
  });
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("downtown");
  await expect(file).toHaveValue("");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Import stock", exact: true }),
  ).toBeDisabled();
});

test("SIM import submits once and locks its receiving details while saving", async ({
  page,
}) => {
  const state = await setup(page),
    dialog = await inventory(page);
  state.hold();
  await dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(
    dialog.getByRole("combobox", { name: "Branch", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Excel file", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Reason for stock addition")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  state.release();
  await expect(dialog.getByRole("status")).toContainText("2 SIMs added");
  await expect(
    dialog.getByRole("combobox", { name: "Branch", exact: true }),
  ).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});

test("monthly SR preview works after the daily date was cleared", async ({
  page,
}, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sr-verification");
  await page.getByLabel("Sales date", { exact: true }).fill("");
  await page
    .getByRole("combobox", { name: "Report period", exact: true })
    .selectOption("monthly");
  const month = await page
    .getByLabel("Sales month", { exact: true })
    .inputValue();
  await page.getByLabel("Daily SR report", { exact: true }).setInputFiles({
    name: "report.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("sr_number,status\nSR-100,CLOSED\n"),
  });
  await page
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toMatchObject({
    period: month,
    business_date: "",
    apply: false,
  });
  await expect(
    page.getByRole("heading", { name: "Report preview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("monthly-sr-preview-phone.png"),
    fullPage: true,
  });
});

for (const stage of ["SIM", "SR preview", "SR apply"]) {
  test(`${stage} can retry a rejected request without getting stuck`, async ({
    page,
  }) => {
    const state = await setup(page);
    let submit;
    if (stage === "SIM") {
      const dialog = await inventory(page);
      submit = dialog.getByRole("button", {
        name: "Import stock",
        exact: true,
      });
    } else {
      await page.goto("/sr-verification");
      await page
        .getByLabel("Daily SR report", { exact: true })
        .setInputFiles({
          name: "report.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("sr_number,status\nSR-100,CLOSED\n"),
        });
      if (stage === "SR apply") {
        await page
          .getByRole("button", { name: "Preview matches", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Apply verification", exact: true }),
        ).toBeEnabled();
      }
      submit = page.getByRole("button", {
        name: stage === "SR apply" ? "Apply verification" : "Preview matches",
        exact: true,
      });
    }
    const before = state.writes.length;
    state.rejectNext();
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(
      "Correct the report and try again.",
    );
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (stage === "SIM")
      await expect(
        page.getByRole("status").filter({ hasText: "2 SIMs added" }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("heading", {
          name:
            stage === "SR apply"
              ? "Applied report comparison"
              : "Report preview",
          exact: true,
        }),
      ).toBeVisible();
    expect(state.writes).toHaveLength(before + 2);
  });
}

for (const apply of [false, true]) {
  test(`SR ${apply ? "apply" : "preview"} ignores repeated clicks until completion`, async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto("/sr-verification");
    await page.getByLabel("Daily SR report", { exact: true }).setInputFiles({
      name: "report.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("sr_number,status\nSR-100,CLOSED\n"),
    });
    if (apply) {
      await page
        .getByRole("button", { name: "Preview matches", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Apply verification", exact: true }),
      ).toBeEnabled();
    }
    state.hold();
    const before = state.writes.length;
    await page
      .getByRole("button", {
        name: apply ? "Apply verification" : "Preview matches",
        exact: true,
      })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect.poll(() => state.writes.length).toBe(before + 1);
    await expect(
      page.getByRole("combobox", { name: "Report period", exact: true }),
    ).toBeDisabled();
    state.release();
    await expect(
      page.getByRole("heading", {
        name: apply ? "Applied report comparison" : "Report preview",
        exact: true,
      }),
    ).toBeVisible();
    expect(state.writes).toHaveLength(before + 1);
  });
}
