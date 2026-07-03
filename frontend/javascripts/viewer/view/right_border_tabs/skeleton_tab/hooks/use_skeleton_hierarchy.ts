import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { buildSkeletonHierarchy, type SkeletonHierarchy, type TreeSortBy } from "../hierarchy";

export function useTreeSortBy(): TreeSortBy {
  return useWkSelector((state) => (state.userConfiguration.sortTreesByName ? "name" : "timestamp"));
}

/*
 * Derives the antd-consumable skeleton hierarchy (plus all key sets derived from it)
 * from the Redux store in a single memoized pass.
 * Must only be used in components that are rendered when a skeleton tracing exists.
 */
export function useSkeletonHierarchy(): SkeletonHierarchy {
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const sortBy = useTreeSortBy();

  return useMemo(
    () => buildSkeletonHierarchy(trees, treeGroups, sortBy),
    [trees, treeGroups, sortBy],
  );
}
