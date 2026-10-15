import { expect as baseExpect, test } from "@playwright/test";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 30000 });

test("whole-branch assignment reaches member clients and enforces the replacement radius", async ({
  page,
  request,
}) => {
  const origin = new URL(process.env.RELAY_WEB_URL || "http://localhost:5174");
  test.skip(
    process.env.RELAY_ALLOW_SETUP_TEST !== "1" ||
      !["127.0.0.1", "localhost"].includes(origin.hostname),
    "Explicit disposable QA API only",
  );
  test.setTimeout(240000);
  const signIn = async (account: string) => {
    const result = await request.post("/api/auth/login", {
      data: {
        email: `${account}@relay.demo`,
        password: process.env.DEMO_PASSWORD,
        native: true,
      },
    });
    expect(result.ok()).toBeTruthy();
    return result.json();
  };
  const admin = await signIn("admin"),
    agent = await signIn("agent1");
  const headers = { Authorization: `Bearer ${admin.access_token}` };
  const agentHeaders = { Authorization: `Bearer ${agent.access_token}` };
  const branchId = agent.user.branch_id;
  expect(branchId).toBeTruthy();
  const site = await request.post("/api/location-tracking/fences", {
    headers,
    data: {
      name: "Isolated branch assignment worksite",
      branch_id: null,
      latitude: 25.08,
      longitude: 55.141,
      radius_m: 500,
      enabled: true,
    },
  });
  expect(site.ok()).toBeTruthy();
  const boundary = await site.json();
  const personal = await request.put(
    `/api/location-tracking/assignments/${agent.user.id}/boundary`,
    {
      headers,
      data: {
        name: "Isolated personal override",
        latitude: 24.7,
        longitude: 54.6,
        radius_m: 100,
        enabled: true,
      },
    },
  );
  expect(personal.ok()).toBeTruthy();
  const branchRows = await request.get(
    "/api/location-tracking/branch-assignments",
    { headers },
  );
  const branch = (await branchRows.json()).find(
    (item: any) => item.id === branchId,
  );
  expect(branch.individual_count).toBeGreaterThan(0);
  await page.goto("/location-tracking");
  await page.getByLabel("Work email", { exact: true }).fill("admin@relay.demo");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await page.getByRole("link", { name: "Work locations", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage boundaries", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `Assign branch boundary for ${branch.name}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Boundary for this branch").selectOption(boundary.id);
  await dialog
    .getByRole("checkbox", { name: /Replace individual boundaries/ })
    .check();
  await dialog
    .getByRole("button", { name: "Apply to all branch members" })
    .click();
  await expect(dialog).toHaveCount(0);
  const currentMembers = await request.get(
    `/api/location-tracking/members?branch_id=${branchId}`,
    { headers },
  );
  const items = (await currentMembers.json()).items;
  expect(items.length).toBeGreaterThan(1);
  for (const member of items) {
    expect(member.assignment_fence_id).toBeNull();
    expect(member.boundary.latitude).toBe(25.08);
    expect(member.boundary.radius_m).toBe(500);
    expect(member.boundary.branch_id).toBe(branchId);
  }
  const me = await request.get("/api/location-tracking/me", {
    headers: agentHeaders,
  });
  expect((await me.json()).boundary.radius_m).toBe(500);
  const denied = await request.put(
    `/api/location-tracking/branch-assignments/${branchId}`,
    { headers: agentHeaders, data: { fence_id: boundary.id } },
  );
  expect(denied.status()).toBe(403);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.resolve("../output/qa/boundary87-connected-branches.png"),
    fullPage: true,
  });
  try {
    expect(
      (
        await request.patch("/api/location-tracking/settings", {
          headers,
          data: { enabled: true },
        })
      ).ok(),
    ).toBeTruthy();
    const started = await request.post("/api/location-tracking/start", {
      headers: agentHeaders,
      data: {
        latitude: 25.08,
        longitude: 55.141,
        accuracy_m: 5,
        captured_at: new Date().toISOString(),
        mocked: false,
        device: "Explicit isolated branch-assignment check",
      },
    });
    expect(started.ok()).toBeTruthy();
    expect((await started.json()).can_capture).toBe(true);
    // Updating the branch radius changes a signed-in client's eligibility immediately.
    const savedBranch = (await me.json()).boundary;
    const edited = await request.patch(
      `/api/location-tracking/fences/${savedBranch.id}`,
      {
        headers,
        data: {
          name: savedBranch.name,
          branch_id: branchId,
          latitude: 25.1,
          longitude: 55.141,
          radius_m: 500,
          enabled: true,
        },
      },
    );
    expect(edited.ok()).toBeTruthy();
    const moved = await request.get("/api/location-tracking/me", {
      headers: agentHeaders,
    });
    expect((await moved.json()).can_capture).toBe(false);
    expect((await moved.json()).latest_location.state).toBe("OUTSIDE");
  } finally {
    await request.patch("/api/location-tracking/settings", {
      headers,
      data: { enabled: false },
    });
    const state = await request.get("/api/location-tracking/me", {
      headers: agentHeaders,
    });
    const session = (await state.json()).work_session;
    if (session)
      await request.post("/api/location-tracking/end", {
        headers: agentHeaders,
        data: { session_id: session.id },
      });
  }
});
