import { QueryClient } from "@tanstack/react-query";

// The app-wide react-query client. It lives in its own module so that React roots
// outside of the main tree (see render_independently.tsx) can share the same cache.
export const reactQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: Number.POSITIVE_INFINITY,
    },
  },
});

/**
 * Call when a user logs in. The cache (also persisted to localStorage) may still hold data that was
 * fetched anonymously or for a previous user. Unlike clear(), resetting keeps the queries of
 * mounted components attached to the cache and refetches them right away.
 */
export function resetQueryCacheOnLogin() {
  void reactQueryClient.resetQueries();
}
