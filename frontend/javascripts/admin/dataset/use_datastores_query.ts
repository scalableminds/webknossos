import { useQuery } from "@tanstack/react-query";
import { getDatastores } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";

/**
 * The datastores the active user can access. The backend returns none to anonymous users, so the
 * request waits for a login (e.g., during the onboarding) and is repeated for each user.
 */
export function useDatastoresQuery() {
  const activeUserId = useWkSelector((state) => state.activeUser?.id);
  return useQuery({
    queryKey: ["datastores", activeUserId],
    queryFn: getDatastores,
    enabled: activeUserId != null,
  });
}
