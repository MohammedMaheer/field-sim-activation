import { expect, Page, test } from "@playwright/test";

const record = {
  id: "print-sale-a", agent_id: "agent-a", creator_id: "agent-user", status: "VERIFIED", version: 2,
  source_reference: "REQ-100000001", document_kind: "SALE_SCREENSHOTS", created_at: "2026-10-11T08:00:00Z",
  activation_label: "Activated · SR mismatch", payment_record_status: "RECORDED", sr_verification: {status: "MISMATCH"},
  intake: {capture_mode: "SCREENSHOT_SALE", name: "Jordan & Vale", document_number: "7841999999999876", msisdn: "0500000000", plan_name: "Freedom 325"},
  rows: [], lines: [], history: [],
  invoice: {heading: "Sale confirmed", status: "Verified", sections: [
    {title: "Invoice", fields: [{label: "Sale reference", value: "SALE-A"}, {label: "Date", value: "11 Oct 2026"}]},
    {title: "Customer", fields: [{label: "Customer name", value: "Jordan & Vale"}, {label: "Document number", value: "7841999999999876"}, {label: "Nationality", value: "United Arab Emirates"}]},
    {title: "SIM & plan", fields: [{label: "Request ID", value: "REQ-100000001"}, {label: "Plan", value: "Freedom 325"}, {label: "Monthly charge", value: "325"}, {label: "Prepayment on order", value: "0"}, {label: "Router serial", value: "Not recorded"}]},
    {title: "Records", fields: [{label: "Verified by", value: "Independent reviewer"}, {label: "Order details screen", value: "Captured"}]},
    {title: "SR verification", fields: [{label: "Status", value: "Mismatch"}, {label: "Result", value: "Not in uploaded SR report"}]},
    {title: "Order details", fields: [{label: "Notes", value: "<script>window.invalidReceipt=true</script>"}]},
  ]},
};

async function fixture(page: Page, capture = record) {
  await page.addInitScript(() => {
    (window as any).receiptPrintCalls = 0;
    window.print = () => {(window as any).receiptPrintCalls++;};
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data: any = [];
    if (path === "/api/auth/refresh") data = {access_token: "synthetic", user: {id: "admin-a", name: "Admin Evaluation", role: "Administrator", permissions: ["read", "report.read", "compliance.write"]}};
    else if (path === "/api/notifications") data = {items: [], categories: [], unread: 0};
    else if (path === "/api/events/stream") return route.fulfill({contentType: "text/event-stream", body: ""});
    else if (path === "/api/resources/agents") data = [{id: "agent-a", name: "Evaluation Sales Agent", employee_id: "QN-001", branch: "Marina Branch"}];
    else if (path === "/api/kyc-captures/print-sale-a" || path === "/api/kyc-captures/print-sale-a/print-data") data = capture;
    else if (path === "/api/kyc-captures") data = [capture];
    else if (path.endsWith("/original")) return route.fulfill({contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3qkAAAAASUVORK5CYII=", "base64")});
    return route.fulfill({json: data});
  });
  await page.goto("/kyc-capture?capture=print-sale-a");
  await expect(page.getByRole("heading", {name: "Backend verification", exact: true})).toBeVisible();
}

test("reference bill prints complete isolated paper and normalizes cached invoice sections", async ({page}) => {
  await fixture(page);
  await expect(page.locator(".review-history").filter({hasText: "Reference bill"}).first()).not.toHaveAttribute("open", "");
  await page.locator("summary").filter({hasText: /^Reference bill$/}).click();
  await expect(page.locator(".invoice-sections h3").first()).toHaveText("Reference details");
  await expect(page.locator(".receipt-kiosk-assembly img")).toHaveCount(1);
  await expect(page.locator(".receipt-kiosk-screen img")).toHaveCount(0);
  await expect(page.locator(".receipt-paper-brand")).not.toContainText("REFERENCE BILL");
  await expect(page.locator(".invoice-sections")).toContainText("SALE-A");
  await expect(page.getByRole("button", {name: "Show supporting details", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Print reference bill", exact: true}).click();
  const frame = page.frameLocator('iframe[title="Qanawat receipt print document"]');
  await expect(frame.locator("h1")).toHaveText("Reference bill");
  await expect(frame.locator("h2").first()).toHaveText("Reference details");
  await expect(frame.locator("h2").filter({hasText: /^Reference bill$/})).toHaveCount(0);
  await expect(frame.locator("img")).toHaveCount(1);
  await expect(frame.locator("body")).toContainText("Activated · SR mismatch");
  await expect(frame.locator("body")).toContainText("Nationality");
  await expect(frame.locator("body")).toContainText("Independent reviewer");
  await expect(frame.locator("body")).toContainText("Not recorded");
  await expect(frame.locator("body")).toContainText("<script>window.invalidReceipt=true</script>");
  await expect(frame.locator("body")).toContainText("•••• 9876");
  await expect(frame.locator("body")).not.toContainText("7841999999999876");
  await expect(frame.locator("body")).not.toContainText("Review inbox");
  await expect(frame.locator("button")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).receiptPrintCalls)).toBe(0);
  expect(await frame.locator("body").evaluate(() => (window as any).receiptPrintCalls)).toBe(1);
  expect(await frame.locator("body").evaluate(() => (window as any).invalidReceipt)).toBeUndefined();
  await expect(frame.getByRole("img", {name: "Qanawat Connect Solutions LLC"})).toBeVisible();
  expect(await frame.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const paper = await page.context().newPage();
  await paper.setContent(await frame.locator("html").evaluate((el) => el.outerHTML));
  await paper.emulateMedia({media: "print"});
  await paper.pdf({path: "../output/qa/qanawat-sale-receipt-paper.pdf", format: "A4", preferCSSPageSize: true, printBackground: true});
  await paper.screenshot({path: "../output/qa/qanawat-sale-receipt-paper.png", fullPage: true});
  await paper.close();
  await page.screenshot({path: "../output/qa/qanawat-sale-receipt-print-action.png"});
});

test("rejected receipt printing retains correction status and legacy document masking", async ({page}) => {
  await fixture(page, {...record, status: "REJECTED", document_kind: "ACTIVATION_RECEIPT", activation_label: "", invoice: undefined as any,
    intake: {...record.intake, capture_mode: "LEGACY"}, rows: [{fields: [{label: "Passport number", value: "P12345678"}, {label: "Total paid", value: "AED 199.00"}]}] as any});
  await page.locator("summary").filter({hasText: /^Historical receipt$/}).click();
  await page.getByRole("button", {name: "Print receipt", exact: true}).click();
  const frame = page.frameLocator('iframe[title="Qanawat receipt print document"]');
  await expect(frame.locator("h1")).toHaveText("Activation receipt");
  await expect(frame.locator("body")).toContainText("Correction required");
  await expect(frame.locator("body")).toContainText("AED 199.00");
  await expect(frame.locator("body")).toContainText("•••• 5678");
  await expect(frame.locator("body")).not.toContainText("P12345678");
});

test("printing reads the current server state and refuses newly revoked receipt access", async ({page}) => {
  await fixture(page);
  await page.locator("summary").filter({hasText: /^Reference bill$/}).click();
  await page.route("**/api/kyc-captures/print-sale-a/print-data", (route) => route.fulfill({json: {...record, activation_label: "Fully activated"}}));
  await page.getByRole("button", {name: "Print reference bill", exact: true}).click();
  const frame = page.frameLocator('iframe[title="Qanawat receipt print document"]');
  await expect(frame.locator("body")).toContainText("Fully activated");
  await page.locator('iframe[title="Qanawat receipt print document"]').evaluate((el) => el.remove());
  await page.route("**/api/kyc-captures/print-sale-a/print-data", (route) => route.fulfill({status: 403, json: {detail: "This receipt is no longer available to your account."}}));
  await page.getByRole("button", {name: "Print reference bill", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("This receipt is no longer available");
  await expect(page.locator('iframe[title="Qanawat receipt print document"]')).toHaveCount(0);
});

test("reference bill has an immediate Home link and retains readable controls on a narrow screen", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await fixture(page);
  await page.locator("summary").filter({hasText: /^Reference bill$/}).click();
  const home = page.locator(".receipt-kiosk-assembly").getByRole("link", {name: "Home", exact: true});
  await expect(home).toHaveAttribute("href", "/");
  await home.scrollIntoViewIfNeeded();
  await expect(home).toBeVisible();
  await expect(page.getByRole("button", {name: "Replay reference bill printing", exact: true})).toBeVisible();
  const assembly = page.locator(".receipt-kiosk-assembly");
  await assembly.locator(".verified-receipt").evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  expect(await assembly.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: "../output/qa/reference-bill-home-390.png", fullPage: true});
  await home.click();
  await expect(page).toHaveURL(/\/$/);
});
