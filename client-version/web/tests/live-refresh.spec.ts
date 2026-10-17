import { expect, test } from "@playwright/test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { workspaceRefresh } from "../src/liveRefresh";

test("events preserve a slow first snapshot and then fetch its current replacement", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let aborted = false;
  const observer = new QueryObserver(client, {
    queryKey: ["slow-page"],
    queryFn: async ({ signal }) => {
      const call = ++calls;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      if (call === 1) await waiting;
      return call === 1 ? "old snapshot" : "latest snapshot";
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const controller = new AbortController();
  const refresh = workspaceRefresh(client, controller.signal);
  const pending = refresh();
  await refresh();
  await refresh();
  expect(calls).toBe(1);
  expect(aborted).toBe(false);
  release();
  await pending;
  expect(client.getQueryData(["slow-page"])).toBe("latest snapshot");
  expect(calls).toBeLessThanOrEqual(3);
  expect(aborted).toBe(false);
  unsubscribe();
  client.clear();
});

test("ending the signed-in session prevents the queued follow-up refresh", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["old-account"],
    queryFn: async () => {
      calls++;
      await waiting;
      return "old";
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const controller = new AbortController();
  const refresh = workspaceRefresh(client, controller.signal);
  const pending = refresh();
  await refresh();
  controller.abort();
  release();
  await pending;
  expect(calls).toBe(1);
  unsubscribe();
  client.clear();
});
