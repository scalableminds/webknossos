import { useWkSelector } from "libs/react_hooks";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import type { CommentType } from "viewer/model/types/tree_types";
import { getCommentNodeKey, getTreeNodeKey } from "../comment_tab_types";

export function useActiveComment(): CommentType | null {
  return useWkSelector((state) => {
    const skeletonTracing = getSkeletonTracing(state.annotation);
    if (skeletonTracing == null) {
      return null;
    }
    const { activeNodeId } = skeletonTracing;
    const { activeTreeId } = state.localSkeletonState;
    if (activeTreeId == null || activeNodeId == null) {
      return null;
    }
    return (
      skeletonTracing.trees
        .getNullable(activeTreeId)
        ?.comments.find((comment) => comment.nodeId === activeNodeId) ?? null
    );
  });
}

export function useActiveRowKey(): string | null {
  const activeComment = useActiveComment();
  const activeTreeId = useWkSelector((state) => state.localSkeletonState.activeTreeId);

  // Highlight the active node's comment or, if it has none, the active tree.
  if (activeComment != null) {
    return getCommentNodeKey(activeComment.nodeId);
  }
  return activeTreeId != null ? getTreeNodeKey(activeTreeId) : null;
}
