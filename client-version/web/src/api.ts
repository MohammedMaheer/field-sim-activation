export type Row = Record<string, any>;
let access = "";
let refreshPromise: Promise<any> | null = null;
export function setAccess(token: string) {
  access = token;
}
export async function refreshSession() {
  if (!refreshPromise)
    refreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Please sign in");
        const data = await r.json();
        access = data.access_token;
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}
export async function api(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<any> {
  const r = await fetch("/api" + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + access,
      ...options.headers,
    },
  });
  if (r.status === 401 && retry && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
      return api(path, options, false);
    } catch {
      window.dispatchEvent(new Event("session-expired"));
    }
  }
  if (!r.ok) {
    const body = await r
      .json()
      .catch(() => ({ detail: "Request failed. Please try again." }));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "Check the required fields and try again.",
    );
  }
  return r.json();
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export async function download(path: string, name: string, retry = true) {
  const r = await fetch("/api" + path, {
    headers: { Authorization: "Bearer " + access },
  });
  if (r.status === 401 && retry) {
    try {
      await refreshSession();
    } catch {
      window.dispatchEvent(new Event("session-expired"));
      throw new Error("Your session expired. Sign in and retry the export.");
    }
    return download(path, name, false);
  }
  if (!r.ok)
    throw new Error("Export failed. Check your permissions and try again.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function stream(
  signal: AbortSignal,
  onEvent: (kind?: string) => void,
  onState: (live: boolean) => void,
) {
  while (!signal.aborted) {
    try {
      const r = await fetch("/api/events/stream", {
        headers: { Authorization: "Bearer " + access },
        signal,
      });
      if (r.status === 401) {
        await refreshSession();
        continue;
      }
      if (!r.ok || !r.body) throw new Error("Stream unavailable");
      onState(true);
      onEvent();
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const b of blocks) if (b.startsWith("data:")) onEvent(JSON.parse(b.slice(5)).kind);
      }
    } catch {
      onState(false);
    }
    onState(false);
    if (!signal.aborted)
      await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
