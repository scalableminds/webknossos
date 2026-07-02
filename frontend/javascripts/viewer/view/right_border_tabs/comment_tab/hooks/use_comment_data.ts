import { useMemo } from "react";
import type { CommentType, Tree, TreeMap } from "viewer/model/types/tree_types";
import {
  getSortedComments,
  getSortedTreesWithComments,
  type SortByEnum,
} from "viewer/view/right_border_tabs/comment_tab/comment_sorting";

export type CommentData = {
  // Trees that have at least one comment, sorted according to the current settings.
  sortedTrees: Tree[];
  // All comments across those trees, flattened and sorted - used for search and navigation.
  flatComments: CommentType[];
};

// Derives the sorted tree/comment data shown in the comment tab. The result is
// memoized so that downstream consumers receive referentially stable arrays
// across re-renders as long as the inputs are unchanged.
export function useCommentData(
  trees: TreeMap,
  sortBy: SortByEnum,
  isSortedAscending: boolean,
): CommentData {
  return useMemo(() => {
    const sortedTrees = getSortedTreesWithComments(trees, sortBy, isSortedAscending);
    const flatComments = getSortedComments(sortedTrees, sortBy, isSortedAscending);
    return { sortedTrees, flatComments };
  }, [trees, sortBy, isSortedAscending]);
}
