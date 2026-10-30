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
