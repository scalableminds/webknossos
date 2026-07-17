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
    const { activeTreeId, activeNodeId } = skeletonTracing;
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
  const activeTreeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeTreeId ?? null,
  );

  // Highlight the active node's comment or, if it has none, the active tree.
  if (activeComment != null) {
    return getCommentNodeKey(activeComment.nodeId);
  }
  return activeTreeId != null ? getTreeNodeKey(activeTreeId) : null;
}
