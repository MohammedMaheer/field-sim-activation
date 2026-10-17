import { QueryClient } from "@tanstack/react-query";

/** Coalesce events without discarding a page's in-flight data request. */
export function workspaceRefresh(client: QueryClient, signal: AbortSignal) {
  let requested = false;
  let running = false;
  return async () => {
    requested = true;
    if (running || signal.aborted) return;
    running = true;
    try {
      while (requested && !signal.aborted) {
        requested = false;
        const firstSnapshots = new Set(
          client
            .getQueryCache()
            .findAll({ type: "active" })
            .filter(
              (query) =>
                query.state.fetchStatus === "fetching" &&
                query.state.data === undefined,
            )
            .map((query) => query.queryHash),
        );
        await client.invalidateQueries({}, { cancelRefetch: false });
        // A first snapshot may predate the event. Let it finish, then refresh
        // it once; restarting it on each event can prevent a slow page loading.
        if (firstSnapshots.size && !signal.aborted)
          await client.invalidateQueries(
            { predicate: (query) => firstSnapshots.has(query.queryHash) },
            { cancelRefetch: false },
          );
      }
    } finally {
      running = false;
    }
  };
}
