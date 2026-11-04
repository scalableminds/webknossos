import { queryOptions } from "@tanstack/react-query";
import { getAuthToken } from "admin/rest_api";

// The auth token is a secret and must never be cached: every view fetches it freshly when it
// mounts and drops it from the cache as soon as it unmounts. main.tsx additionally excludes it
// from being persisted to localStorage.
export const authTokenQueryOptions = queryOptions({
  queryKey: ["authToken"],
  queryFn: getAuthToken,
  staleTime: 0,
  gcTime: 0,
  meta: { persist: false },
});
