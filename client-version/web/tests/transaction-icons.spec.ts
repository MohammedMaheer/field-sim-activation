import { test, expect } from "@playwright/test";

// Render the production step component using Vite, independently of login/API.
test("reference progress has three visible icons at desktop and phone sizes", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 600 });
    for (const step of [1, 2, 3]) {
      await page.evaluate(
        async ({ step }) => {
          const { default: React } =
            await import("/node_modules/.vite/deps/react.js");
          const { default: ReactDOM } =
            await import("/node_modules/.vite/deps/react-dom_client.js");
          const { default: Progress } =
            await import("/src/TransactionProgress.tsx");
          let host = document.getElementById("icon-evidence");
          if (!host) {
            document.getElementById("root")!.style.display = "none";
            host = document.createElement("div");
            host.id = "icon-evidence";
            host.style.cssText =
              "padding:20px;max-width:1100px;margin:40px auto;background:white;border-radius:16px";
            document.body.append(host);
            (window as any).iconRoot = ReactDOM.createRoot(host);
          }
          (window as any).iconRoot.render(
            React.createElement(Progress, { step }),
          );
        },
        { step },
      );
      const steps = page.getByRole("list", { name: "Transaction steps" });
      await expect(steps.locator("li")).toHaveCount(3);
      await expect(steps.locator('[aria-current="step"]')).toContainText(
        `STEP ${step} OF 3`,
      );
      await expect(steps.locator(".done")).toHaveCount(step - 1);
      await expect(steps.locator("svg")).toHaveCount(3);
      for (const icon of await steps.locator("svg").all()) {
        await expect(icon).toBeVisible();
        const box = await icon.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(20);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: `../output/qa/transaction-icons/web-${width}-step-${step}.png`,
      });
    }
  }
});
