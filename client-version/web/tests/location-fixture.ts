import { Page } from "@playwright/test";

export const fence = {
  id: "marina-fence",
  name: "Marina work boundary",
  branch_id: "marina",
  latitude: 25.2,
  longitude: 55.27,
  radius_m: 200,
  enabled: true,
};
export const branches = [
  { id: "marina", name: "Marina Branch" },
  { id: "downtown", name: "Downtown Branch" },
];
export async function setup(
  page: Page,
  options: {
    role?: string;
    manage?: boolean;
    read?: boolean;
    enabled?: boolean;
    session?: boolean;
    outside?: boolean;
    denied?: boolean;
  } = {},
) {
  const writes: { path: string; body: any }[] = [],
    requests: string[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("qanawat.location.device.viewer", "web-test-device"),
  );
  let enabled = options.enabled ?? false;
  let session: any = options.session
    ? {
        id: "work-1",
        started_at: new Date().toISOString(),
        ended_at: null,
        device: "Qanawat web:web-test-device",
      }
    : null;
  let point: any = session
    ? {
        latitude: 25.2,
        longitude: 55.27,
        accuracy_m: 5,
        captured_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        state: options.outside ? "OUTSIDE" : "INSIDE",
        fresh: true,
        distance_m: 0,
      }
    : null;
  const role = options.role || "Administrator";
  const manage = options.manage ?? role === "Administrator",
    read = options.read ?? manage;
  const permissions = [
    "read",
    "location.self",
    ...(read ? ["location.read"] : []),
    ...(manage ? ["location.manage", "settings.write"] : []),
    ...(role === "Field Agent" ? ["ekyc.write"] : []),
  ];
  if (role === "Tele Verification Officer") permissions.push("call.tele.read");
  const state = () => ({
    enabled,
    boundary: fence,
    work_session: session,
    latest_location: point,
    can_capture: !enabled || (!!session && point?.state === "INSIDE"),
    can_start: !enabled || !options.outside,
    reason:
      options.outside && enabled
        ? "Capturing a sale is blocked outside your assigned boundary."
        : enabled && !session
          ? "Start work tracking inside your assigned boundary."
          : "",
    permissions: { read_members: read, manage },
  });
  const members = () => [
    {
      ...state(),
      user_id: "sales-agent",
      name: "Jordan Vale",
      email: "jordan@example.test",
      role: "Field Agent",
      branch_id: "marina",
      branch: "Marina Branch",
      assignment_fence_id: null,
    },
    {
      ...state(),
      user_id: "leader",
      name: "Mira Rowan",
      email: "mira@example.test",
      role: "Team Leader",
      branch_id: "downtown",
      branch: "Downtown Branch",
      latest_location: null,
      work_session: null,
      assignment_fence_id: null,
    },
  ];
  if (!options.denied) {
    await page.context().grantPermissions(["geolocation"]);
    await page
      .context()
      .setGeolocation({ latitude: 25.2, longitude: 55.27, accuracy: 5 });
  }
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    if (route.request().url().includes("styles"))
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#e7e8f0" },
            },
          ],
        },
      });
    return route.fulfill({
      json: { tilejson: "3.0.0", tiles: [], minzoom: 0, maxzoom: 14 },
    });
  });
  await page.route("https://gibs.earthdata.nasa.gov/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      target = url.pathname;
    requests.push(target);
    const body =
      request.method() === "GET" ? undefined : request.postDataJSON();
    if (request.method() !== "GET" && !target.includes("auth"))
      writes.push({ path: target, body });
    let data: any = [];
    if (target === "/api/auth/refresh")
      data = {
        access_token: "location-synthetic",
        user: { id: "viewer", name: "Demo viewer", role, permissions },
      };
    else if (target === "/api/events/stream")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    else if (target === "/api/notifications")
      data = { items: [], categories: [], unread: 0 };
    else if (target === "/api/resources/branches") data = branches;
    else if (target === "/api/resources/agents")
      data = [
        {
          id: "agent",
          name: "Demo viewer",
          branch_id: "marina",
          branch: "Marina Branch",
        },
      ];
    else if (target === "/api/location-tracking/me") data = state();
    else if (target === "/api/location-tracking/map-imagery")
      data = {
        available: true,
        available_date: "2026-10-13",
        tile_url: "https://gibs.earthdata.nasa.gov/test/{z}/{y}/{x}.jpeg",
        max_zoom: 9,
        resolution_m: 250,
      };
    else if (target === "/api/location-tracking/members")
      data = {
        items: members().filter(
          (member) =>
            !url.searchParams.get("branch_id") ||
            member.branch_id === url.searchParams.get("branch_id"),
        ),
        branches,
        enabled,
      };
    else if (target === "/api/location-tracking/fences") data = [fence];
    else if (target === "/api/location-tracking/settings") {
      if (request.method() === "PATCH") enabled = body.enabled;
      data = {
        enabled,
        freshness_seconds: 90,
        max_accuracy_m: 100,
        retention_days: 30,
      };
    } else if (target === "/api/location-tracking/start") {
      if (enabled && options.outside)
        return route.fulfill({
          status: 422,
          json: {
            detail: "Starting work is blocked outside your assigned boundary.",
          },
        });
      session = {
        id: "work-1",
        started_at: new Date().toISOString(),
        ended_at: null,
        device: body.device,
      };
      point = {
        ...body,
        received_at: body.captured_at,
        fresh: true,
        state: "INSIDE",
        distance_m: 0,
      };
      data = state();
    } else if (target === "/api/location-tracking/points") {
      point = {
        ...body,
        received_at: body.captured_at,
        fresh: true,
        state: options.outside ? "OUTSIDE" : "INSIDE",
        distance_m: 0,
      };
      data = state();
    } else if (target === "/api/location-tracking/end") {
      session = null;
      data = state();
    } else if (target === "/api/location-tracking/export")
      return route.fulfill({
        contentType: "text/csv",
        headers: {
          "Content-Disposition":
            'attachment; filename="qanawat-work-locations.csv"',
        },
        body: "Member,Latitude,Longitude,Boundary\nJordan,25.2,55.27,Marina",
      });
    else if (target === "/api/kyc-captures/draft")
      data = { version: 1, data: {} };
    else if (target === "/api/subscriber-plans")
      data = [{ id: "plan", name: "Freedom", price: 325 }];
    await route.fulfill({ json: data });
  });
  return { writes, requests };
}
