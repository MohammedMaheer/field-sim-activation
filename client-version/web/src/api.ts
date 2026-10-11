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
    if (r.status === 429)
      throw new Error("Too many requests. Wait a minute and try again.");
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
  const pending = pendingExports.get(path);
  if (pending) return pending;
  const id = path;
  const state = (phase: string, detail = {}) =>
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
      if (r.status === 401) {
        try {
          await refreshSession();
        } catch {
          window.dispatchEvent(new Event("session-expired"));
          throw new Error(
            "Your session expired. Sign in and retry the export.",
          );
        }
        r = await request();
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
      pendingExports.delete(path);
    }
  })();
  pendingExports.set(path, task);
  return task;
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
        for (const b of blocks)
          if (b.startsWith("data:")) onEvent(JSON.parse(b.slice(5)).kind);
      }
    } catch {
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
  const response = await fetch("/api" + path, {
    credentials: "include",
    signal,
    headers: { Authorization: "Bearer " + access },
  });
  if (response.status === 401 && retry) {
    await refreshSession();
    return receiptImage(path, signal, false);
  }
  if (!response.ok)
    throw new Error(
      "Could not load the original receipt. Check access or retry.",
    );
  return response.blob();
}
