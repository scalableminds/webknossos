import { compareBy, localeCompareBy } from "libs/utils";
import { useCallback, useMemo, useState } from "react";
import type { Comparator } from "types/type_utils";
import type { CommentType, Tree } from "viewer/model/types/tree_types";
import { type CommentSorting, CommentSortMode } from "../comment_tab_types";

export function getTreeComparator({ mode, isAscending }: CommentSorting): Comparator<Tree> {
  return mode === CommentSortMode.ID
    ? compareBy<Tree>((tree) => tree.treeId, isAscending)
    : localeCompareBy<Tree>(
        (tree) => `${tree.name}_${tree.treeId}`,
        isAscending,
        mode === CommentSortMode.NATURAL,
      );
}

export function getCommentComparator({
  mode,
  isAscending,
}: CommentSorting): Comparator<CommentType> {
  return mode === CommentSortMode.ID
    ? compareBy<CommentType>((comment) => comment.nodeId, isAscending)
    : localeCompareBy<CommentType>(
        (comment) => `${comment.content}_${comment.nodeId}`,
        isAscending,
        mode === CommentSortMode.NATURAL,
      );
}

export function useCommentSorting() {
  const [mode, setMode] = useState(CommentSortMode.NAME);
  const [isAscending, setIsAscending] = useState(true);

  const sorting: CommentSorting = useMemo(() => ({ mode, isAscending }), [mode, isAscending]);
  const toggleSortDirection = useCallback(() => setIsAscending((value) => !value), []);

  return { sorting, setSortMode: setMode, toggleSortDirection };
}
