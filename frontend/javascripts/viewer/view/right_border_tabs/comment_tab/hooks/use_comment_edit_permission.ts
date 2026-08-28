import { useWkSelector } from "libs/react_hooks";
import {
  getReasonForCantEditSkeletonTree,
  mayEditSkeletonTree,
} from "viewer/model/accessors/annotation_accessor";
import {
  getActiveNode,
  getActiveTree,
  getSkeletonTracing,
} from "viewer/model/accessors/skeletontracing_accessor";

/*
 * Whether the active node's comment may currently be edited, and — if not — the
 * reason to surface in a tooltip. Editing requires an active node and an active
 * skeleton tree the user is allowed to mutate (in concurrent collaboration mode
 * only agglomerate/proofreading trees qualify).
 */
export function useCommentEditPermission(): { isDisabled: boolean; disabledReason: string | null } {
  const isDisabled = useWkSelector((state) => {
    const skeletonTracing = getSkeletonTracing(state.annotation);
    if (skeletonTracing == null) {
      return true;
    }
    const activeTree = getActiveTree(state);
    return (
      getActiveNode(skeletonTracing, state.localSkeletonState.activeTreeId) == null ||
      !mayEditSkeletonTree(state, activeTree)
    );
  });
  const disabledReason = useWkSelector((state) => {
    const activeTree = getActiveTree(state);
    return getReasonForCantEditSkeletonTree(state, activeTree) ?? null;
  });

  return { isDisabled, disabledReason };
}
