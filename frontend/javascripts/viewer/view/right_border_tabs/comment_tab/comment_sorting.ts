import { compareBy, localeCompareBy } from "libs/utils";
import type { Comparator } from "types/type_utils";
import type { CommentType, Tree, TreeMap } from "viewer/model/types/tree_types";

export enum SortByEnum {
  NAME = "NAME",
  ID = "ID",
  NATURAL = "NATURAL",
}

export function getTreeSorter(sortBy: SortByEnum, isSortedAscending: boolean): Comparator<Tree> {
  return sortBy === SortByEnum.ID
    ? compareBy<Tree>((tree) => tree.treeId, isSortedAscending)
    : localeCompareBy<Tree>(
        (tree) => `${tree.name}_${tree.treeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

export function getCommentSorter(
  sortBy: SortByEnum,
  isSortedAscending: boolean,
): Comparator<CommentType> {
  return sortBy === SortByEnum.ID
    ? compareBy<CommentType>((comment) => comment.nodeId, isSortedAscending)
    : localeCompareBy<CommentType>(
        (comment) => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

export function getSortedTreesWithComments(
  trees: TreeMap,
  sortBy: SortByEnum,
  isSortedAscending: boolean,
): Tree[] {
  return trees
    .values()
    .filter((tree) => tree.comments.length > 0)
    .toArray()
    .sort(getTreeSorter(sortBy, isSortedAscending));
}

// Flattens the comments of the given (already filtered) trees into a single
// sorted array, e.g. for keyboard navigation or search.
export function getSortedComments(
  trees: Tree[],
  sortBy: SortByEnum,
  isSortedAscending: boolean,
): CommentType[] {
  const commentSorter = getCommentSorter(sortBy, isSortedAscending);
  return trees.flatMap((tree) => tree.comments.slice().sort(commentSorter));
}
