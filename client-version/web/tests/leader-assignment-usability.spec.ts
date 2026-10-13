import { expect, Page, test } from "@playwright/test";
import { previewBuild } from "./preview";

async function workspace(page: Page, management = true) {
  await previewBuild(page);
  const branches = [
    { id: "marina", name: "Marina Branch", agents: 1, target: 20 },
    { id: "downtown", name: "Downtown Branch", agents: 0, target: 20 },
    { id: "empty", name: "Garden Branch", agents: 0, target: 20 },
  ];
  let leaders = [
    {
      id: "mira",
      name: "Mira Rowan",
      email: "mira@example.test",
      branch_id: "marina",
      agents: 1,
    },
    {
      id: "avery",
      name: "Avery Reed",
      email: "avery@example.test",
      branch_id: "marina",
      agents: 0,
    },
    {
      id: "rayan",
      name: "Rayan Vale",
      email: "rayan@example.test",
      branch_id: "downtown",
      agents: 0,
    },
    {
      id: "taylor",
      name: "Taylor Quinn",
      email: "taylor@example.test",
      branch_id: null as string | null,
      agents: 0,
    },
  ];
  let agents = [
    {
      id: "zayn",
      name: "Zayn Mercer",
      employee_id: "QN-001",
      branch_id: "marina",
      branch: "Marina Branch",
      outlet_id: "marina-outlet",
      target: 20,
      leader_id: "mira",
      leader: "Mira Rowan",
      status: "ACTIVE",
      employment_status: "ACTIVE",
      activations: 2,
      achievement: 10,
      stock: 0,
      aht: 5,
      ekyc_rate: 100,
      ocr: 99,
      last_sync: "2026-10-13T08:00:00Z",
    },
  ];
  const writes: { path: string; body: any }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    let data: any = [];
    if (path === "/api/auth/refresh")
      data = {
        access_token: "synthetic-usability",
        user: {
          id: "admin",
          name: "Admin reviewer",
          role: management ? "Administrator" : "Sales Manager",
          permissions: management
            ? ["read", "settings.write", "report.read"]
            : ["read", "report.read"],
        },
      };
    else if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path === "/api/notifications")
      data = { items: [], unread: 0, categories: [] };
    else if (path === "/api/resources/branches") data = branches;
    else if (path === "/api/resources/agents")
      data = agents.filter(
        (row) =>
          !url.searchParams.get("branch_id") ||
          row.branch_id === url.searchParams.get("branch_id"),
      );
    else if (path === "/api/resources/team-leaders")
      data = leaders
        .filter(
          (person) =>
            !url.searchParams.get("branch_id") ||
            person.branch_id === url.searchParams.get("branch_id"),
        )
        .map((person) => ({
          ...person,
          leader_id: person.id,
          id: person.id + ":" + (person.branch_id || "unassigned"),
          branch:
            branches.find((branch) => branch.id === person.branch_id)?.name ||
            "Not assigned",
          active: person.agents,
          stock: 0,
        }));
    else if (path === "/api/organization")
      data = {
        branches,
        leaders,
        outlets: branches.map((branch) => ({
          id: branch.id + "-outlet",
          branch_id: branch.id,
          name: branch.name,
        })),
      };
    else if (path === "/api/agents/zayn/management") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        writes.push({ path, body });
        const selected = branches.find(
          (branch) => branch.id + "-outlet" === body.outlet_id,
        )!;
        agents = agents.map((row) => ({
          ...row,
          ...body,
          branch_id: selected.id,
          branch: selected.name,
          leader: leaders.find((person) => person.id === body.leader_id)!.name,
        }));
        leaders = leaders.map((person) => ({
          ...person,
          agents: person.id === body.leader_id ? 1 : 0,
        }));
      }
      data = {
        agent: agents[0],
        leaders,
        outlets: branches.map((branch) => ({
          id: branch.id + "-outlet",
          branch_id: branch.id,
          branch: branch.name,
        })),
      };
    } else if (path.startsWith("/api/administration/teams/")) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      leaders = leaders.map((person) =>
        person.id === path.split("/").at(-1)
          ? { ...person, ...body.values }
          : person,
      );
      data = { saved: true };
    } else if (path.endsWith("/leaders")) {
      const branchId = path.split("/")[4];
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        writes.push({ path, body });
        leaders = leaders.map((person) => ({
          ...person,
          branch_id: body.leader_ids.includes(person.id)
            ? branchId
            : person.branch_id === branchId
              ? null
              : person.branch_id,
        }));
      }
      data = {
        branch: branches.find((branch) => branch.id === branchId),
        leaders: leaders.filter((person) => person.branch_id === branchId),
        available_leaders: leaders.filter((person) => !person.branch_id),
      };
    }
    await route.fulfill({ json: data });
  });
  return {
    writes,
    management: () => ({
      agent: agents[0],
      leaders,
      outlets: branches.map((branch) => ({
        id: branch.id + "-outlet",
        branch_id: branch.id,
        branch: branch.name,
      })),
    }),
  };
}

async function neat(page: Page, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const dialog = page.getByRole("dialog");
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          Number(getComputedStyle(element).opacity) *
          Number(getComputedStyle(element.parentElement!).opacity),
      ),
    )
    .toBe(1);
  const collisions = await dialog
    .locator(
      "input:not([type=hidden]):not([type=checkbox]),select,textarea,button",
    )
    .evaluateAll((elements) => {
      const visible = elements
        .filter((el) => el.getClientRects().length)
        .map((el) => ({
          name: el.textContent || el.getAttribute("name"),
          r: el.getBoundingClientRect(),
        }));
      return visible.flatMap((field, index) =>
        visible
          .slice(index + 1)
          .filter(
            (other) =>
              Math.min(field.r.right, other.r.right) -
                Math.max(field.r.left, other.r.left) >
                2 &&
              Math.min(field.r.bottom, other.r.bottom) -
                Math.max(field.r.top, other.r.top) >
                2,
          )
          .map((other) => `${field.name} / ${other.name}`),
      );
    });
  expect(collisions).toEqual([]);
  await page.screenshot({
    path: `../output/qa/leader-usability-${name}-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
}

for (const width of [1440, 390]) {
  test(`sales agent can reassign leader and branch deliberately at ${width}px`, async ({
    page,
  }) => {
    const { writes } = await workspace(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/agents");
    await page
      .getByRole("button", { name: "View Zayn Mercer", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", {
        name: "Change branch or team leader",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Current sales agent assignment" }),
    ).toContainText("Mira Rowan");
    await expect(
      dialog.getByRole("button", { name: "Review assignment changes" }),
    ).toBeDisabled();
    await dialog
      .getByRole("combobox", { name: "Assigned branch", exact: true })
      .selectOption("empty");
    await expect(
      dialog.getByRole("combobox", {
        name: "Reporting team leader",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(dialog.getByRole("status")).toContainText(
      "No team leader is assigned to Garden Branch",
    );
    await dialog
      .getByRole("combobox", { name: "Assigned branch", exact: true })
      .selectOption("downtown");
    await expect(
      dialog
        .getByRole("combobox", { name: "Reporting team leader", exact: true })
        .locator("option"),
    ).toHaveText(["Select team leader", "Rayan Vale"]);
    await dialog
      .getByRole("combobox", { name: "Reporting team leader", exact: true })
      .selectOption("rayan");
    await dialog
      .getByLabel("Reason for change", { exact: true })
      .fill("Approved transfer to Downtown");
    await neat(page, "agent-edit");
    await dialog
      .getByRole("button", { name: "Review assignment changes" })
      .click();
    expect(writes).toHaveLength(0);
    await expect(
      dialog.getByRole("region", { name: "Review sales agent assignment" }),
    ).toContainText("Marina Branch → Downtown Branch");
    await expect(
      dialog.getByRole("region", { name: "Review sales agent assignment" }),
    ).toContainText("Mira Rowan → Rayan Vale");
    await neat(page, "agent-review");
    await dialog
      .getByRole("button", { name: "Back to edit", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", {
        name: "Reporting team leader",
        exact: true,
      }),
    ).toHaveValue("rayan");
    await dialog
      .getByRole("button", { name: "Review assignment changes" })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm assignment changes" })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(writes[0]).toEqual({
      path: "/api/agents/zayn/management",
      body: {
        outlet_id: "downtown-outlet",
        leader_id: "rayan",
        target: 20,
        expected_outlet_id: "marina-outlet",
        expected_leader_id: "mira",
        expected_target: 20,
        reason: "Approved transfer to Downtown",
      },
    });
    await page
      .getByRole("button", { name: "View Zayn Mercer", exact: true })
      .click();
    await expect(dialog).toContainText("Downtown Branch");
    await expect(dialog).toContainText("Rayan Vale");
  });

  test(`team leader profile and branch changes are separate at ${width}px`, async ({
    page,
  }) => {
    const { writes } = await workspace(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/team-leaders");
    const occupied = page.locator(".leader-card").filter({
      has: page.getByRole("heading", { name: "Mira Rowan", exact: true }),
    });
    await occupied
      .getByRole("button", { name: "Change branch", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("combobox", { name: "Branch", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Review branch change", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText(
      "Reassign this team leader’s 1 sales agent first",
    );
    await neat(page, "leader-blocked");
    await dialog
      .getByRole("link", { name: "View sales agents to reassign", exact: true })
      .click();
    await expect(page).toHaveURL(/agents\?leader=mira/);
    await expect(page.locator(".assignment-filter")).toContainText(
      "Sales agents reporting to Mira Rowan",
    );
    await expect(
      page.getByRole("button", { name: "View Zayn Mercer", exact: true }),
    ).toBeVisible();
    await page.goto("/team-leaders");
    const available = page.locator(".leader-card").filter({
      has: page.getByRole("heading", { name: "Avery Reed", exact: true }),
    });
    await available
      .getByRole("button", { name: "Edit details", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", { name: "Branch", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Team leader name", { exact: true })
      .fill("Avery Rowan");
    await dialog
      .getByLabel("Reason for change", { exact: true })
      .fill("Corrected team leader name");
    await dialog
      .getByRole("button", { name: "Save team leader details", exact: true })
      .click();
    expect(writes[0].body.values).toEqual({
      name: "Avery Rowan",
      email: "avery@example.test",
    });
    const updated = page.locator(".leader-card").filter({
      has: page.getByRole("heading", { name: "Avery Rowan", exact: true }),
    });
    await updated
      .getByRole("button", { name: "Change branch", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Branch", exact: true })
      .selectOption("downtown");
    await dialog
      .getByLabel("Reason for change", { exact: true })
      .fill("Approved team leader branch move");
    await dialog
      .getByRole("button", { name: "Review branch change", exact: true })
      .click();
    expect(writes).toHaveLength(1);
    await expect(
      dialog.getByRole("region", { name: "Review team leader branch change" }),
    ).toContainText("Avery Rowan → Downtown Branch");
    await neat(page, "leader-review");
    await dialog
      .getByRole("button", { name: "Confirm branch change", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(writes[1].body.values).toEqual({
      name: "Avery Rowan",
      email: "avery@example.test",
      branch_id: "downtown",
    });
    expect(writes[1].body.expected.branch_id).toBe("marina");
  });
}

test("existing leader assignment is distinct from creating an account", async ({
  page,
}) => {
  const { writes } = await workspace(page);
  await page.goto("/team-leaders");
  await page
    .getByRole("button", { name: "Assign existing team leader", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption("marina");
  await expect(
    dialog.getByLabel("Team leader name", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("checkbox", { name: /Mira Rowan/ }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /Taylor Quinn/ }).check();
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Assign additional branch team leader");
  await dialog
    .getByRole("button", { name: "Review team leader changes", exact: true })
    .click();
  expect(writes).toHaveLength(0);
  await expect(
    dialog.getByRole("region", { name: "Review branch leader changes" }),
  ).toContainText("Assign: Taylor Quinn");
  await dialog
    .getByRole("button", { name: "Confirm team leader changes", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({
    leader_ids: ["mira", "avery", "taylor"],
    expected_leader_ids: ["mira", "avery"],
  });
});

test("view-only manager cannot edit leaders or sales agent assignments", async ({
  page,
}) => {
  await workspace(page, false);
  await page.goto("/team-leaders");
  for (const name of [
    "Add team leader",
    "Assign existing team leader",
    "Edit details",
    "Change branch",
    "Assign branch",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await page.goto("/agents");
  await page
    .getByRole("button", { name: "View Zayn Mercer", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Change branch or team leader",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Assignment", exact: true }),
  ).toHaveCount(0);
});

test("a stale assignment gives a clear reload path without resubmitting old values", async ({
  page,
}) => {
  const state = await workspace(page);
  let conflict = false;
  await page.route("**/api/agents/zayn/management", async (route) => {
    if (route.request().method() === "PATCH") {
      conflict = true;
      await route.fulfill({
        status: 409,
        json: {
          detail: "Assignment changed. Reopen management before saving.",
        },
      });
    } else if (conflict) {
      const data = state.management();
      await route.fulfill({
        json: { ...data, agent: { ...data.agent, target: 30 } },
      });
    } else await route.fallback();
  });
  await page.goto("/agents?selected=zayn");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Change branch or team leader", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Reporting team leader", exact: true })
    .selectOption("avery");
  await dialog
    .getByLabel("Reason for change", { exact: true })
    .fill("Approved reporting line update");
  await dialog
    .getByRole("button", { name: "Review assignment changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm assignment changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Assignment changed");
  expect(state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Reload current assignment", exact: true })
    .click();
  await expect(
    dialog.getByRole("spinbutton", { name: "Total daily target", exact: true }),
  ).toHaveValue("30");
  await expect(
    dialog.getByRole("combobox", {
      name: "Reporting team leader",
      exact: true,
    }),
  ).toHaveValue("mira");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test('historical leader branch is distinguished from the current editable assignment', async ({page}) => {
  await workspace(page);
  await page.route('**/api/resources/team-leaders*', route => route.fulfill({json:[
    {id:'mira:marina',leader_id:'mira',name:'Mira Rowan',branch_id:'marina',branch:'Marina Branch',current_branch_id:'downtown',current_branch:'Downtown Branch',historical_assignment:true,agents:0,active:0,stock:0},
    {id:'mira:downtown',leader_id:'mira',name:'Mira Rowan',branch_id:'downtown',branch:'Downtown Branch',current_branch_id:'downtown',current_branch:'Downtown Branch',historical_assignment:false,agents:1,active:1,stock:0},
  ]}));
  await page.goto('/team-leaders');
  const historical=page.locator('article').filter({hasText:'Historical sales'});
  await expect(historical).toContainText('Current branch: Downtown Branch');
  await expect(historical.getByRole('button',{name:'Change branch',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Change branch',exact:true})).toHaveCount(1);
  await page.screenshot({path:'../output/qa/leader-usability-historical-current.png',animations:'disabled'});
});
