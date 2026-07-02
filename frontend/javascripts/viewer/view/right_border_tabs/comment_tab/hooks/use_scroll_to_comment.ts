import type { Tree as AntdTree, GetRef } from "antd";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { MutableCommentType } from "viewer/model/types/tree_types";

// Keeps the comment tree scrolled to (and highlighting) the comment of the
// active node, or - if that node has no comment - its parent tree. Returns the
// ref to attach to the tree and the keys that should appear highlighted.
export function useScrollToComment(
  activeComment: MutableCommentType | undefined,
  activeTreeId: number | undefined | null,
  isVisibleInDom: boolean,
) {
  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<React.Key[]>([]);

  useEffect(() => {
    if (!isVisibleInDom) {
      return;
    }

    // Technically the comment is now present in the tree and it can also be found while debugging
    // this class. But due to some React or virtual rendering magic in the scrollTo function,
    // the new comment isn't found right away in the tree data, thus the timeout is used as a work-around.
    setTimeout(() => {
      if (treeRef.current)
        if (activeComment) {
          const commentNodeKey = `comment-${activeComment.nodeId}`;
          treeRef.current.scrollTo({ key: commentNodeKey, align: "top" });
          setHighlightedNodeIds([commentNodeKey]);
        } else if (activeTreeId) {
          const treeNodeKey = activeTreeId.toString();
          treeRef.current.scrollTo({
            key: treeNodeKey,
            align: "top",
          });
          setHighlightedNodeIds([treeNodeKey]);
        }
    });
  }, [activeComment, activeTreeId, isVisibleInDom]);

  return { treeRef, highlightedNodeIds };
}
