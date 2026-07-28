import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import type { CommentType, Tree } from "viewer/model/types/tree_types";
import {
  type CommentSorting,
  getCommentNodeKey,
  getTreeNodeKey,
  type TreeRowNode,
} from "../comment_tab_types";
import { getCommentComparator, getTreeComparator } from "./use_comment_sorting";

/*
 * The skeleton's TreeMap changes its identity on every store mutation (e.g. each
 * placed node). This equality function keeps the selected trees referentially
 * stable as long as nothing that the comment tab renders has changed, so all
 * derived data (and thus the virtualized tree) can be memoized effectively.
 */
function areTreesWithCommentsEqual(treesA: Tree[], treesB: Tree[]): boolean {
  return (
    treesA.length === treesB.length &&
    treesA.every((tree, index) => {
      const otherTree = treesB[index];
      return (
        tree.treeId === otherTree.treeId &&
        tree.name === otherTree.name &&
        tree.color === otherTree.color &&
        tree.comments === otherTree.comments
      );
    })
  );
}

function useTreesWithComments(): Tree[] {
  return useWkSelector(
    (state) =>
      getSkeletonTracing(state.annotation)
        ?.trees.values()
        .filter((tree) => tree.comments.length > 0)
        .toArray() ?? [],
    areTreesWithCommentsEqual,
  );
}

/*
 * Derives the node structure for the virtualized tree plus a flat list of all
 * comments (in rendering order), which drives the search and the
 * previous/next navigation.
 */
export function useCommentTabData(sorting: CommentSorting): {
  treeNodes: TreeRowNode[];
  sortedComments: CommentType[];
} {
  const treesWithComments = useTreesWithComments();

  return useMemo(() => {
    const treeComparator = getTreeComparator(sorting);
    const commentComparator = getCommentComparator(sorting);

    const treeNodes: TreeRowNode[] = treesWithComments
      .slice()
      .sort(treeComparator)
      .map((tree) => ({
        key: getTreeNodeKey(tree.treeId),
        type: "tree",
        tree,
        isLeaf: false,
        children: tree.comments
          .slice()
          .sort(commentComparator)
          .map((comment) => ({
            key: getCommentNodeKey(comment.nodeId),
            type: "comment",
            comment,
            isLeaf: true,
          })),
      }));

    const sortedComments = treeNodes.flatMap((treeNode) =>
      treeNode.children.map((commentNode) => commentNode.comment),
    );

    return { treeNodes, sortedComments };
  }, [treesWithComments, sorting]);
}
