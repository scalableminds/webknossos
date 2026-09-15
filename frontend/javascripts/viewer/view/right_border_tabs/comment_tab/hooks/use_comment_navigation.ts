import { InputKeyboard } from "libs/input";
import { useWkSelector } from "libs/react_hooks";
import { mod } from "libs/utils";
import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { CommentType } from "viewer/model/types/tree_types";
import type { KeyboardShortcutHandlerMap } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";

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
