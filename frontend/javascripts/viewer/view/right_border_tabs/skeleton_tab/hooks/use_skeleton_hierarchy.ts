import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  areTreeMapsEqualForHierarchy,
  buildSkeletonHierarchy,
  type SkeletonHierarchy,
  type TreeSortBy,
} from "../hierarchy";

function useTreeSortBy(): TreeSortBy {
  return useWkSelector((state) => (state.userConfiguration.sortTreesByName ? "name" : "timestamp"));
}

/*
 * Derives the antd-consumable skeleton hierarchy (plus all key sets derived from it)
 * from the Redux store in a single memoized pass.
 * Must only be used in components that are rendered when a skeleton tracing exists.
 */
export function useSkeletonHierarchy(): SkeletonHierarchy {
  // The TreeMap changes identity on every skeleton mutation. A custom equality
  // (see areTreeMapsEqualForHierarchy) keeps the reference stable unless a field
  // the hierarchy renders/sorts by actually changed, so the memoized rebuild
  // below is skipped for mutations like node moves.
  const trees = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).trees,
    areTreeMapsEqualForHierarchy,
  );
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const sortBy = useTreeSortBy();

  return useMemo(
    () => buildSkeletonHierarchy(trees, treeGroups, sortBy),
    [trees, treeGroups, sortBy],
  );
}
