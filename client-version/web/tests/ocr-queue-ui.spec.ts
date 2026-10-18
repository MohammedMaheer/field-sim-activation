import { expect, test, Page } from "@playwright/test";
import path from "node:path";
import { previewBuild } from "./preview";

async function setup(page: Page, start = true) {
  await previewBuild(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: any = [];
    if (url.pathname === "/api/auth/refresh")
      data = {
        access_token: "synthetic-access",
        user: {
          id: "ops",
          name: "Operations",
          role: "Operations Manager",
          permissions: ["read", "ekyc.write"],
          agent_id: "sales-agent",
        },
      };
    if (url.pathname === "/api/kyc-captures/draft")
      data = { version: 1, data: {} };
    if (url.pathname === "/api/resources/agents")
      data = [
        { id: "sales-agent", name: "Sales Agent", branch_id: "branch-one" },
      ];
    if (url.pathname === "/api/resources/plans")
      data = [{ id: "plan-one", name: "First printed plan" }];
    if (url.pathname === "/api/notifications")
      data = { items: [], categories: [], unread: 0 };
    if (url.pathname === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json: data });
  });
  await page.goto("/kyc-capture");
  if (start) {
    const newTransaction = page.getByRole("button", {
      name: "New transaction capture",
      exact: true,
    });
    await newTransaction.click();
    await expect(newTransaction).toBeEnabled();
    await expect(
      page.getByLabel("Customer details screen", { exact: true }),
    ).toBeAttached();
  }
}
const customer = {
  name: "Avery Stone",
  document_number: "SAMPLE-ID-001",
  nationality: "United Arab Emirates",
  birth_date: "1990-01-01",
  expiry_date: "2031-12-31",
  document_check: "synthetic-proof",
};

test("a photo still decoding cannot repopulate a newly started transaction", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    (window as any).photoDecoding = false;
    window.createImageBitmap = async (...args: any[]) => {
      (window as any).photoDecoding = true;
      await new Promise<void>((resolve) => {
        (window as any).finishPhotoDecode = resolve;
      });
      const bitmap = await (decode as any)(...args);
      (window as any).photoDecoded = true;
      return bitmap;
    };
  });
  await setup(page);
  let submitted = 0;
  await page.route("**/api/kyc-captures/ocr-jobs", (route) => {
    submitted++;
    return route.fulfill({
      status: 500,
      json: { detail: "Unexpected old photo" },
    });
  });
  await page.getByLabel("Full name", { exact: true }).fill("Previous customer");
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(path.resolve("../mobile/assets/demo/identity.png"));
  await expect
    .poll(() => page.evaluate(() => (window as any).photoDecoding))
    .toBe(true);
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("");
  await page.evaluate(() => (window as any).finishPhotoDecode());
  await expect
    .poll(() => page.evaluate(() => (window as any).photoDecoded))
    .toBe(true);
  await expect(page.getByAltText("Captured customer details")).toHaveCount(0);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("");
  expect(submitted).toBe(0);
});

for (const delayed of ["progress", "saved copy"]) {
  test(`a late ${delayed} response cannot replace the next transaction`, async ({
    page,
  }) => {
    await setup(page);
    let finish!: () => void;
    let waiting = false;
    const endpoint = delayed === "progress" ? "draft" : "saved-drafts";
    await page.route(`**/api/kyc-captures/${endpoint}`, async (route) => {
      if (
        !waiting &&
        route.request().method() === (delayed === "progress" ? "PUT" : "POST")
      ) {
        waiting = true;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      await route.fulfill({ json: { version: 2, id: "saved-one", data: {} } });
    });
    await page
      .getByLabel("Full name", { exact: true })
      .fill("Earlier customer");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => waiting).toBe(true);
    await page
      .getByRole("button", { name: "New transaction capture", exact: true })
      .click();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("");
    await page.getByLabel("Full name", { exact: true }).fill("New customer");
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/kyc-captures/${endpoint}` &&
        r.request().method() === (delayed === "progress" ? "PUT" : "POST"),
    );
    finish();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("dialog", { name: "Drafts", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "New customer",
    );
  });
}

test("an unreadable automatic camera frame does not cancel saving a partial draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => new MediaStream(),
    });
    HTMLMediaElement.prototype.play = async () => {};
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      get: () => 480,
    });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (args[0] instanceof HTMLVideoElement) {
        this.fillStyle = "white";
        this.fillRect(0, 0, this.canvas.width, this.canvas.height);
      } else (draw as any).apply(this, args);
    } as typeof draw;
  });
  await setup(page);
  let finish!: () => void;
  let saving = false;
  let frames = 0;
  await page.route("**/api/kyc-captures/ocr-jobs", (route) => {
    frames++;
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 202,
      json: {
        id: body.operation_id,
        stage: "DOCUMENT",
        status: "COMPLETED",
        result: {},
      },
    });
  });
  await page.route("**/api/kyc-captures/draft", async (route) => {
    if (route.request().method() === "PUT") {
      saving = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    await route.fulfill({ json: { version: 2, data: {} } });
  });
  await page.getByLabel("Full name", { exact: true }).fill("Partial customer");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saving).toBe(true);
  await expect.poll(() => frames, { timeout: 10000 }).toBeGreaterThan(0);
  finish();
  await expect(
    page.getByRole("dialog", { name: "Drafts", exact: true }),
  ).toBeVisible();
});

test("starting a new transaction blocks the old upload until draft reset completes", async ({
  page,
}) => {
  await setup(page, false);
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Previous unfinished customer");
  let finish!: () => void;
  await page.route("**/api/kyc-captures/draft", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    await route.fulfill({ json: { version: 2, data: {} } });
  });
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(
    page.getByText("Preparing your transaction…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Customer details screen", { exact: true }),
  ).toHaveCount(0);
  finish();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Customer details screen", { exact: true }),
  ).toBeAttached();
});

test("a rejected draft reset restores the current fields instead of clearing them", async ({
  page,
}) => {
  await setup(page, false);
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Keep this customer");
  await page.route("**/api/kyc-captures/draft", (route) =>
    route.fulfill(
      route.request().method() === "PUT"
        ? {
            status: 409,
            json: {
              detail: "This draft changed. Reload before starting again.",
            },
          }
        : { json: { version: 1, data: {} } },
    ),
  );
  await page
    .getByRole("button", { name: "New transaction capture", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This draft changed." }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Keep this customer",
  );
  await expect(
    page.getByRole("button", { name: "New transaction capture", exact: true }),
  ).toBeEnabled();
});

test("busy upload retains photo and reuses one operation through the queue", async ({
  page,
}) => {
  await setup(page);
  const operations: string[] = [];
  let reads = 0;
  await page.route("**/api/kyc-captures/ocr-jobs", async (route) => {
    const body = route.request().postDataJSON();
    operations.push(body.operation_id);
    if (operations.length === 1)
      return route.fulfill({
        status: 429,
        json: { detail: "Scanner queue busy" },
      });
    await route.fulfill({
      status: 202,
      json: {
        id: "job-one",
        stage: "DOCUMENT",
        status: "QUEUED",
        retry_after: 1,
      },
    });
  });
  await page.route("**/api/kyc-captures/ocr-jobs/job-one", (route) =>
    route.fulfill({
      json: {
        id: "job-one",
        stage: "DOCUMENT",
        status: ++reads === 1 ? "PROCESSING" : "COMPLETED",
        result: customer,
        retry_after: 1,
      },
    }),
  );
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(path.resolve("../mobile/assets/demo/identity.png"));
  await expect(
    page.getByText("Photo retained · waiting to reconnect…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Avery Stone",
    { timeout: 15000 },
  );
  expect(new Set(operations).size).toBe(1);
  await page.screenshot({
    path: "../output/qa/ocr76-customer-queued-completed.png",
  });
});

test("replacement order clears its old plan and charges while preserving customer", async ({
  page,
}) => {
  await setup(page);
  let orders = 0;
  await page.route("**/api/kyc-captures/ocr-jobs", (route) => {
    const body = route.request().postDataJSON();
    const result =
      body.stage === "DOCUMENT"
        ? customer
        : ++orders === 1
          ? {
              order_type: "NEW",
              package_name: "First printed plan",
              plan_id: "plan-one",
              plan_name: "First printed plan",
              msisdn: "0500000000",
              order_reference: "REQ-12345",
              monthly_cost: "350",
              prepayment: "0",
              order_check: "first-proof",
            }
          : {
              package_name: "Unlisted printed plan",
              msisdn: "0500000000",
              order_reference: "REQ-54321",
              order_check: "second-proof",
            };
    return route.fulfill({
      status: 202,
      json: {
        id: body.operation_id,
        stage: body.stage,
        status: "COMPLETED",
        result,
      },
    });
  });
  const fixture = path.resolve("../mobile/assets/demo/identity.png");
  await page
    .getByLabel("Customer details screen", { exact: true })
    .setInputFiles(fixture);
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Avery Stone",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Order details screen", { exact: true })
    .setInputFiles(fixture);
  await expect(page.getByLabel("Monthly charge", { exact: true })).toHaveValue(
    "350",
  );
  await page
    .getByLabel("Order details screen", { exact: true })
    .setInputFiles(path.resolve("../mobile/assets/demo/order.png"));
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(
    "REQ-54321",
  );
  await expect(page.getByLabel("Monthly charge", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("combobox", { name: "Subscriber plan", exact: true }),
  ).toHaveValue("");
  await page.screenshot({ path: "../output/qa/ocr76-order-recapture.png" });
});
