import { expect, test } from "@playwright/test";

test("a committed draft with a lost response retries once and survives in shared Drafts", async ({
  page,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname),
    "Mutations require the isolated local QA service",
  );
  await page.goto("/");
  await page.locator('input[type="email"]').fill("agent1@relay.demo");
  await page.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(page.locator('input[type="password"]')).toBeHidden();
  const auth = await request.post("/api/auth/login", {
    data: {
      email: "agent1@relay.demo",
      password: process.env.DEMO_PASSWORD,
      native: true,
    },
  });
  expect(auth.status()).toBe(200);
  const headers = {
    Authorization: `Bearer ${(await auth.json()).access_token}`,
  };
  let savedId = "";
  let first = true;
  try {
    await page.goto("/kyc-capture");
    await page
      .getByRole("button", { name: "New transaction capture", exact: true })
      .click();
    const name = `Recovery customer ${Date.now()}`;
    await page.getByLabel("Full name", { exact: true }).fill(name);
    await page.route("**/api/kyc-captures/saved-drafts", async (route) => {
      if (route.request().method() === "POST" && first) {
        first = false;
        const committed = await route.fetch();
        expect(committed.status()).toBe(201);
        savedId = (await committed.json()).id;
        return route.abort("connectionreset");
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /fetch|network/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      name,
    );
    expect(savedId).not.toBe("");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Drafts", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(name, { exact: true })).toHaveCount(1);
    const stored = await request.get("/api/kyc-captures/saved-drafts", {
      headers,
    });
    expect(stored.status()).toBe(200);
    expect(
      (await stored.json())
        .filter((row: any) => row.data.name === name)
        .map((row: any) => row.id),
    ).toEqual([savedId]);
    await page.screenshot({ path: "../output/qa/recovery92-saved-once.png" });
  } finally {
    if (savedId)
      expect(
        (
          await request.delete(`/api/kyc-captures/saved-drafts/${savedId}`, {
            headers,
          })
        ).status(),
      ).toBe(200);
  }
});
