import { InputKeyboard } from "libs/input";
import { useWkSelector } from "libs/react_hooks";
import { compareBy, localeCompareBy, mod } from "libs/utils";
import messages from "messages";
import { type Key, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { Comparator } from "types/type_utils";
import { isAnnotationOwner, mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  createCommentAction,
  deleteCommentAction,
  setActiveNodeAction,
} from "viewer/model/actions/skeletontracing_actions";
import type { CommentType, Tree } from "viewer/model/types/tree_types";
import type { KeyboardShortcutHandlerMap } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";
import {
  type CommentSorting,
  CommentSortMode,
  getCommentNodeKey,
  getTreeNodeKey,
  type TreeRowNode,
} from "./comment_tab_types";

function getTreeComparator({ mode, isAscending }: CommentSorting): Comparator<Tree> {
  return mode === CommentSortMode.ID
    ? compareBy<Tree>((tree) => tree.treeId, isAscending)
    : localeCompareBy<Tree>(
        (tree) => `${tree.name}_${tree.treeId}`,
        isAscending,
        mode === CommentSortMode.NATURAL,
      );
}

function getCommentComparator({ mode, isAscending }: CommentSorting): Comparator<CommentType> {
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

// A single-line <input> cannot display real line breaks, so they are shown as the
// literal character sequence "\n" and converted back when saving.
const encodeLineBreaks = (content: string) => content.replace(/\r?\n/g, "\\n");
const decodeLineBreaks = (inputValue: string) => inputValue.replace(/\\n/g, "\n");

/*
 * Everything needed to display and edit the comment of the currently active node.
 * Saving an empty string deletes the comment.
 */
export function useActiveCommentEditing() {
  const dispatch = useDispatch();
  const activeComment = useActiveComment();
  const activeNodeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeNodeId ?? null,
  );
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector(isAnnotationOwner);

  const saveComment = useCallback(
    (content: string) => {
      if (content !== "") {
        dispatch(createCommentAction(content));
      } else {
        dispatch(deleteCommentAction());
      }
    },
    [dispatch],
  );

  const saveCommentFromInput = useCallback(
    (inputValue: string) => saveComment(decodeLineBreaks(inputValue)),
    [saveComment],
  );

  return {
    activeComment,
    activeNodeId,
    inputValue: activeComment != null ? encodeLineBreaks(activeComment.content) : "",
    isMultiline: activeComment?.content.includes("\n") ?? false,
    isDisabled: activeNodeId == null || !allowUpdate,
    disabledReason: allowUpdate
      ? null
      : messages["tracing.read_only_mode_notification"](isLockedByOwner, isOwner),
    saveComment,
    saveCommentFromInput,
  };
}

export type CommentEditing = ReturnType<typeof useActiveCommentEditing>;

/*
 * Jumps to the previous/next comment relative to the active node, following the
 * current sort order and wrapping around at both ends.
 */
export function useCommentNavigation(sortedComments: CommentType[]) {
  const dispatch = useDispatch();
  const activeNodeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeNodeId ?? null,
  );

  const jumpToComment = useCallback(
    (offset: 1 | -1) => {
      if (activeNodeId == null || sortedComments.length === 0) {
        return;
      }
      const currentIndex = sortedComments.findIndex((comment) => comment.nodeId === activeNodeId);
      // If the active node has no comment, jump to the first/last comment.
      const newIndex =
        currentIndex === -1
          ? offset === 1
            ? 0
            : sortedComments.length - 1
          : mod(currentIndex + offset, sortedComments.length);
      dispatch(setActiveNodeAction(sortedComments[newIndex].nodeId));
    },
    [activeNodeId, sortedComments, dispatch],
  );

  const nextComment = useCallback(() => jumpToComment(1), [jumpToComment]);
  const previousComment = useCallback(() => jumpToComment(-1), [jumpToComment]);

  return { nextComment, previousComment };
}

export function useCommentKeyboardShortcuts(nextComment: () => void, previousComment: () => void) {
  const shortcutsConfig = useWkSelector((state) => state.keyboardConfiguration.shortcutsConfig);

  // Refs keep the handlers fresh without re-creating the keyboard on every render.
  const nextCommentRef = useRef(nextComment);
  nextCommentRef.current = nextComment;
  const previousCommentRef = useRef(previousComment);
  previousCommentRef.current = previousComment;

  useEffect(() => {
    const keyboardHandlers: Partial<KeyboardShortcutHandlerMap> = {
      NEXT_COMMENT: {
        onPressedWithRepeat: () => nextCommentRef.current(),
        delayed: true,
      },
      PREVIOUS_COMMENT: {
        onPressedWithRepeat: () => previousCommentRef.current(),
        delayed: true,
      },
    };
    const keyboard = new InputKeyboard(
      buildKeyBindingsFromConfig(shortcutsConfig, keyboardHandlers),
    );
    return () => keyboard.destroy();
  }, [shortcutsConfig]);
}

export function useExpandedTreeKeys(treeNodes: TreeRowNode[]) {
  // All trees start out expanded. Trees created afterwards keep their collapse state.
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() => treeNodes.map((node) => node.key));

  const expandTree = useCallback((treeId: number) => {
    const treeKey = getTreeNodeKey(treeId);
    // Returning the unchanged array lets React bail out of the state update.
    setExpandedKeys((keys) => (keys.includes(treeKey) ? keys : [...keys, treeKey]));
  }, []);

  const toggleExpandAll = useCallback(() => {
    setExpandedKeys((keys) => (keys.length > 0 ? [] : treeNodes.map((node) => node.key)));
  }, [treeNodes]);

  return { expandedKeys, setExpandedKeys, expandTree, toggleExpandAll };
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
