import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

async function setup(page: Page) {
  await previewBuild(page);
  const branches = [
    { id: "branch-a", name: "Marina Branch", agents: 1 },
    { id: "branch-b", name: "Downtown Branch", agents: 0 },
    { id: "branch-c", name: "New Branch", agents: 0 },
  ];
  const leaders = [
    { id: "leader-a", name: "Marina Leader One", branch_id: "branch-a", email: "one@example.test" },
    { id: "leader-a2", name: "Marina Leader Two", branch_id: "branch-a", email: "two@example.test" },
    { id: "leader-b", name: "Downtown Leader", branch_id: "branch-b", email: "three@example.test" },
  ];
  const agents = [{ id: "agent-a", name: "Existing Sales Agent", leader_id: "leader-a", branch_id: "branch-a" }];
  const writes: { path: string; data: any }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let data: any = [];
    if (path === "/api/auth/refresh") data = {
      access_token: "synthetic-access", user: {
        id: "admin", name: "Administrator", role: "Administrator",
        permissions: ["read", "settings.write", "compliance.write", "report.read"],
      },
    };
    else if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "" }); return;
    }
    else if (path === "/api/notifications") data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/branches") data = branches;
    else if (path === "/api/resources/agents") data = agents;
    else if (path === "/api/organization") data = { branches, leaders, agents, outlets: [] };
    else if (path.startsWith("/api/organization/") && req.method() === "POST") {
      const values = req.postDataJSON();
      writes.push({ path, data: values });
      if (path.endsWith("/branches")) {
        const branch = { id: "created-branch", name: values.name, agents: 0 };
        branches.push(branch); data = branch;
      } else if (path.endsWith("/teams")) {
        const leader = { id: "created-leader", ...values };
        leaders.push(leader); data = leader;
      } else {
        expect(leaders.some((leader) => leader.id === values.leader_id && leader.branch_id === values.branch_id)).toBe(true);
        const agent = { id: "created-agent", ...values };
        agents.push(agent); data = agent;
      }
    } else if (path.includes("/leaders")) data = { branch: branches[0], leaders, available_leaders: [] };
    await route.fulfill({ json: data });
  });
  return { writes, agents };
}

test("new branch advances to its leader and then its sales agent", async ({ page }) => {
  const { writes } = await setup(page);
  await page.goto("/branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("group", { name: "Setup type" }).getByRole("button")).toHaveText(["Branch", "Team leader", "Sales agent"]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const tabs = dialog.getByRole("group", { name: "Setup type" });
    const boxes = await tabs.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
      const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
    }));
    expect(boxes[0].right).toBeLessThan(boxes[1].left);
    expect(boxes[1].right).toBeLessThan(boxes[2].left);
    expect(Math.abs(boxes[0].width - boxes[2].width)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../output/qa/branch-setup-order-${width}.png`, animations: "disabled" });
  }
  await dialog.getByLabel("Branch name", { exact: true }).fill("Garden Branch");
  await dialog.getByRole("button", { name: "Create branch", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Add team leader", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Branch", exact: true })).toHaveValue("created-branch");
  await dialog.getByLabel("Team leader name", { exact: true }).fill("Garden Leader");
  await dialog.getByLabel("Sign-in email").fill("garden-leader@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("test-client-password");
  await dialog.getByRole("button", { name: "Create team leader", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Add sales agent", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Branch", exact: true })).toHaveValue("created-branch");
  await expect(dialog.getByRole("combobox", { name: "Reporting team leader", exact: true })).toHaveValue("created-leader");
  await dialog.getByLabel("Sales agent name", { exact: true }).fill("Garden Sales Agent");
  await dialog.getByLabel("Employee ID").fill("GARDEN-1");
  await dialog.getByLabel("Sign-in email").fill("garden-agent@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("test-client-password");
  await dialog.getByRole("button", { name: "Create sales agent", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Sales agent created");
  expect(writes.map((write) => write.path)).toEqual(["/api/organization/branches", "/api/organization/teams", "/api/organization/agents"]);
  expect(writes[2].data).toMatchObject({ branch_id: "created-branch", leader_id: "created-leader" });
});

test("agent leader selection follows branch and guides missing setup", async ({ page }) => {
  await setup(page);
  await page.goto("/agents");
  await page.getByRole("button", { name: "Add sales agent", exact: true }).click();
  const dialog = page.getByRole("dialog"), branch = dialog.getByRole("combobox", { name: "Branch", exact: true });
  const leader = dialog.getByRole("combobox", { name: "Reporting team leader", exact: true });
  await branch.selectOption("branch-a");
  await expect(leader.locator("option")).toHaveText(["Select team leader", "Marina Leader One", "Marina Leader Two"]);
  await leader.selectOption("leader-a2");
  await branch.selectOption("branch-b");
  await expect(leader).toHaveValue("leader-b");
  await expect(leader.locator("option")).toHaveText(["Select team leader", "Downtown Leader"]);
  await branch.selectOption("branch-c");
  await expect(leader).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Create sales agent", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Add team leader to this branch", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Add team leader", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Branch", exact: true })).toHaveValue("branch-c");
});

test("adding another leader selects the new leader without reassigning existing agents", async ({ page }) => {
  const { writes, agents } = await setup(page);
  await page.goto("/branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Team leader", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Branch", exact: true }).selectOption("branch-a");
  await dialog.getByLabel("Team leader name", { exact: true }).fill("Marina Leader Three");
  await dialog.getByLabel("Sign-in email").fill("four@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("test-client-password");
  await dialog.getByRole("button", { name: "Create team leader", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Reporting team leader", exact: true })).toHaveValue("created-leader");
  expect(agents[0].leader_id).toBe("leader-a");
  expect(writes.map((write) => write.path)).toEqual(["/api/organization/teams"]);
});
