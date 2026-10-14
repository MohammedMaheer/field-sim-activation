import { expect, test } from "@playwright/test";

test.beforeEach(({ baseURL }) => {
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname),
    "Dialog layout checks use explicitly opted-in isolated QA",
  );
});

for (const width of [1440, 1024, 390]) {
  test(`management dialogs keep complete fields and reachable actions at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await page.locator("input[type=email]").fill("admin@relay.demo");
    await page.locator("input[type=password]").fill(process.env.DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(page.locator("#workspace-content")).toBeVisible({
      timeout: 20000,
    });
    const checks = [
      ["/branches", "Add branch", "add-branch"],
      ["/branches", "Import Excel", "import-branches"],
      ["/team-leaders", "Add team leader", "add-leader"],
      ["/team-leaders", "Assign existing team leader", "assign-leader"],
      ["/team-leaders", "Edit details", "edit-leader"],
      ["/team-leaders", "Change branch", "change-leader-branch"],
      ["/agents", "Add sales agent", "add-agent"],
      ["/agents", "Import Excel", "import-agents"],
      ["/plans", "Add plan", "add-plan"],
      ["/plans", "Edit plan", "edit-plan"],
      ["/inventory", "Import Excel", "import-sims"],
    ];
    for (const [route, name, slug] of checks) {
      await page.goto(route);
      await expect(page.locator(".skeleton")).toHaveCount(0, {
        timeout: 20000,
      });
      const trigger = page.getByRole("button", { name, exact: true }).first();
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".skeleton")).toHaveCount(0, {
        timeout: 20000,
      });
      await expect(dialog.locator(".error-state")).toHaveCount(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        slug,
      ).toBeTruthy();
      const title = (await dialog.locator(".drawer-head h2").boundingBox())!;
      const close = (await dialog
        .getByRole("button", { name: "Close details" })
        .boundingBox())!;
      expect(title.x + title.width).toBeLessThanOrEqual(close.x - 8);
      if (slug.startsWith("import-") && slug !== "import-sims") {
        const input = dialog.locator("input[type=file]");
        expect((await input.boundingBox())!.width).toBeGreaterThan(210);
        await input.setInputFiles({
          name: "approved-branch-sales-agents-october.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("name\nSynthetic layout example\n"),
        });
        await expect(
          dialog.getByRole("button", { name: "Preview import", exact: true }),
        ).toBeEnabled();
        const button = (await dialog
          .getByRole("button", { name: "Preview import", exact: true })
          .boundingBox())!;
        expect(button.height).toBeLessThanOrEqual(48);
        if (width > 600) {
          const field = (await input.boundingBox())!;
          expect(
            Math.abs(field.y + field.height - button.y - button.height),
          ).toBeLessThan(2);
        }
      }
      if (slug === "add-plan") {
        expect(
          await dialog
            .getByLabel("Price (AED)")
            .evaluate((el) => getComputedStyle(el).marginTop),
        ).toBe("0px");
        expect(
          await dialog
            .getByLabel("Price (AED)")
            .evaluate((el) => getComputedStyle(el.parentElement!).marginBottom),
        ).toBe("0px");
      }
      await page.screenshot({
        path: info.outputPath(`${width}-${slug}-top.png`),
        animations: "disabled",
      });
      await dialog.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.screenshot({
        path: info.outputPath(`${width}-${slug}-bottom.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  });
}
