export type Row = Record<string, any>;
export function canViewFinalCommissions(user: Row): boolean {
  return (
    !!user.permissions?.includes("read") &&
    [
      "Administrator",
      "Operations Manager",
      "Sales Manager",
      "Team Leader",
      "Field Agent",
    ].includes(user.role)
  );
}
export function canManageOrganization(user: Row): boolean {
  return (
    ["Administrator", "Operations Manager"].includes(user.role) &&
    user.permissions?.includes("read") &&
    user.permissions?.includes(
      user.role === "Administrator" ? "settings.write" : "task.write",
    )
  );
}
export function canManageMasterData(user: Row, kind: string): boolean {
  if (
    !["Administrator", "Operations Manager"].includes(user.role) ||
    !user.permissions?.includes("read")
  )
    return false;
  if (["agents", "teams"].includes(kind) && user.role !== "Administrator")
    return false;
  return kind === "inventory"
    ? user.permissions.includes("inventory.write")
    : kind === "incentives"
      ? user.permissions.includes("incentive.write")
      : canManageOrganization(user);
}
let access = "";
let captureLocationGuard: (() => Promise<void>) | null = null;
let captureLocationCheck: Promise<void> | null = null;
let workLogoutGuard: (() => Promise<void>) | null = null;
export function setWorkLogoutGuard(guard: (() => Promise<void>) | null) {
  workLogoutGuard = guard;
}
export function setCaptureLocationGuard(guard: (() => Promise<void>) | null) {
  captureLocationGuard = guard;
}
const captureCreates = new Set([
  "/kyc-captures/ocr-jobs",
  "/kyc-captures/read-document",
  "/kyc-captures/read-order",
  "/kyc-captures/receipt-fields",
  "/kyc-captures/sale-submissions",
  "/kyc-captures",
  "/sales-management/sales",
  "/transactions",
]);
let refreshPromise: Promise<any> | null = null;
let sessionEpoch = 0;
let refreshAbort: AbortController | null = null;
const signedOutKey = "qanawat.portal.signed-out";
let deliberatelySignedOut = false;
function signedOut() {
  if (deliberatelySignedOut) return true;
  try {
    return localStorage.getItem(signedOutKey) === "1";
  } catch {
    return false;
  }
}
function checkSession(epoch: number) {
  if (epoch !== sessionEpoch)
    throw new Error(
      "The signed-in account changed. Retry in the current workspace.",
    );
}
export function setAccess(token: string) {
  sessionEpoch++;
  refreshAbort?.abort();
  refreshAbort = null;
  refreshPromise = null;
  access = token;
  if (token) deliberatelySignedOut = false;
  if (token)
    try {
      localStorage.removeItem(signedOutKey);
    } catch {
      /* Storage may be unavailable. */
    }
}
export async function logoutSession() {
  const token = access;
  deliberatelySignedOut = true;
  setAccess("");
  try {
    localStorage.setItem(signedOutKey, "1");
  } catch {
    /* Local session is still cleared. */
  }
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* Local sign-out remains available offline. */
  }
}
export async function refreshSession() {
  if (signedOut())
    throw Object.assign(new Error("Please sign in"), { status: 401 });
  if (!refreshPromise) {
    const epoch = sessionEpoch,
      abort = new AbortController();
    refreshAbort = abort;
    const task = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: abort.signal,
    })
      .then(async (r) => {
        checkSession(epoch);
        if (!r.ok)
          throw Object.assign(
            new Error(
              r.status === 401 || r.status === 403
                ? "Please sign in"
                : "Session renewal is temporarily unavailable. Retry shortly.",
            ),
            { status: r.status },
          );
        const data = await r.json();
        checkSession(epoch);
        access = data.access_token;
        return data;
      })
      .finally(() => {
        if (refreshPromise === task) {
          refreshPromise = null;
          refreshAbort = null;
        }
      });
    refreshPromise = task;
  }
  return refreshPromise;
}
export async function api(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<any> {
  const epoch = sessionEpoch;
  if (options.method === "POST" && path === "/auth/logout" && workLogoutGuard) {
    await workLogoutGuard();
  }
  if (
    options.method === "POST" &&
    captureCreates.has(path.split("?")[0]) &&
    captureLocationGuard
  ) {
    // Concurrent scanner/submission requests share one fresh device-location check.
    if (!captureLocationCheck)
      captureLocationCheck = captureLocationGuard().finally(() => {
        captureLocationCheck = null;
      });
    await captureLocationCheck;
  }
  checkSession(epoch);
  const r = await fetch("/api" + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + access,
      ...options.headers,
    },
  });
  checkSession(epoch);
  if (r.status === 401 && retry && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
      checkSession(epoch);
      return api(path, options, false);
    } catch (failure) {
      checkSession(epoch);
      if ([401, 403].includes((failure as { status?: number }).status || 0))
        window.dispatchEvent(new Event("session-expired"));
      throw failure;
    }
  }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    if (r.status === 429)
      throw Object.assign(
        new Error(
          r.headers.get("Retry-After") === "1"
            ? "Location updates are arriving too quickly. Try again in a second."
            : "Too many requests. Wait a minute and try again.",
        ),
        { status: r.status },
      );
    const body = await r
      .json()
      .catch(() => ({ detail: "Request failed. Please try again." }));
    throw Object.assign(
      new Error(
        typeof body.detail === "string"
          ? body.detail
          : "Check the required fields and try again.",
      ),
      { status: r.status },
    );
  }
  const value = await r.json();
  checkSession(epoch);
  return value;
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
const pendingExports = new Map<string, Promise<void>>();
export function exportFilename(
  disposition: string | null,
  fallback: string,
): string {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  let supplied =
    disposition?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
    disposition?.match(/filename\s*=\s*([^;\s]+)/i)?.[1];
  if (encoded) {
    try {
      supplied = decodeURIComponent(encoded);
    } catch {
      /* Use the safe fallback. */
    }
  }
  const name = (supplied || fallback)
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f<>:"|?*]/g, "-")
    .trim();
  return name.toLowerCase().startsWith("qanawat-")
    ? name
    : "qanawat-" + name.replace(/^relay[-_]/i, "");
}
export function download(path: string, name: string): Promise<void> {
  const epoch = sessionEpoch,
    pendingKey = `${epoch}:${path}`;
  const pending = pendingExports.get(pendingKey);
  if (pending) return pending;
  const id = path;
  const state = (phase: string, detail = {}) =>
    epoch === sessionEpoch &&
    window.dispatchEvent(
      new CustomEvent("export-state", { detail: { phase, id, ...detail } }),
    );
  const task = (async () => {
    state("started");
    try {
      const request = () =>
        fetch("/api" + path, {
          credentials: "include",
          headers: { Authorization: "Bearer " + access },
        });
      let r = await request();
      checkSession(epoch);
      if (r.status === 401) {
        try {
          await refreshSession();
          checkSession(epoch);
        } catch (failure) {
          checkSession(epoch);
          if (
            ![401, 403].includes((failure as { status?: number }).status || 0)
          )
            throw failure;
          window.dispatchEvent(new Event("session-expired"));
          throw new Error(
            "Your session expired. Sign in and retry the export.",
          );
        }
        r = await request();
        checkSession(epoch);
        if (r.status === 401) {
          window.dispatchEvent(new Event("session-expired"));
          throw new Error(
            "Your session expired. Sign in and retry the export.",
          );
        }
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          r.status === 429
            ? "Too many requests. Wait a minute and retry the export."
            : typeof body.detail === "string"
              ? body.detail
              : "Export failed. Check your access and try again.",
        );
      }
      const blob = await r.blob();
      checkSession(epoch);
      if (!blob.size)
        throw new Error(
          "This export is empty. Refresh the page and try again.",
        );
      if (/application\/json|text\/html/.test(blob.type))
        throw new Error(
          "The server did not return an export. Please try again.",
        );
      const filename = exportFilename(
        r.headers.get("content-disposition"),
        name,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Allow browsers on slower devices to finish consuming large exports.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      state("complete", { name: filename });
    } catch (failure) {
      state("failed", {
        error:
          failure instanceof Error
            ? failure.message
            : "Could not export. Please try again.",
      });
      throw failure;
    } finally {
      pendingExports.delete(pendingKey);
    }
  })();
  pendingExports.set(pendingKey, task);
  return task;
}
export async function stream(
  signal: AbortSignal,
  onEvent: (kind?: string) => void,
  onState: (live: boolean) => void,
) {
  const epoch = sessionEpoch;
  let connected = false;
  while (!signal.aborted && epoch === sessionEpoch) {
    try {
      const r = await fetch("/api/events/stream", {
        headers: { Authorization: "Bearer " + access },
        signal,
      });
      if (epoch !== sessionEpoch) return;
      if (r.status === 401) {
        await refreshSession();
        continue;
      }
      if (!r.ok || !r.body) throw new Error("Stream unavailable");
      onState(true);
      if (connected) onEvent("Reconnected");
      connected = true;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const b of blocks)
          if (b.startsWith("data:")) {
            const kind = JSON.parse(b.slice(5)).kind;
            if (kind) onEvent(kind);
          }
      }
    } catch (failure) {
      if (epoch !== sessionEpoch) return;
      if ([401, 403].includes((failure as { status?: number }).status || 0))
        window.dispatchEvent(new Event("session-expired"));
      onState(false);
    }
    onState(false);
    if (!signal.aborted)
      await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export async function receiptImage(
  path: string,
  signal: AbortSignal,
  retry = true,
): Promise<Blob> {
  const epoch = sessionEpoch;
  const response = await fetch("/api" + path, {
    credentials: "include",
    signal,
    headers: { Authorization: "Bearer " + access },
  });
  checkSession(epoch);
  if (response.status === 401 && retry) {
    checkSession(epoch);
    await refreshSession();
    checkSession(epoch);
    return receiptImage(path, signal, false);
  }
  if (!response.ok)
    throw new Error(
      "Could not load the original receipt. Check access or retry.",
    );
  const blob = await response.blob();
  checkSession(epoch);
  return blob;
}
