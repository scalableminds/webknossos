import { InputKeyboard } from "libs/input";
import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { getActiveNode } from "viewer/model/accessors/skeletontracing_accessor";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { SkeletonTracing } from "viewer/store";
import type {
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";
import {
  getSortedComments,
  getSortedTreesWithComments,
  type SortByEnum,
} from "viewer/view/right_border_tabs/comment_tab/comment_sorting";

type NavigationInputs = {
  skeletonTracing: SkeletonTracing;
  sortBy: SortByEnum;
  isSortedAscending: boolean;
};

// Encapsulates jump-to-next/previous-comment behavior and the keyboard bindings
// for it. The navigation callbacks are referentially stable; the latest inputs
// are read from a ref so the keyboard does not have to be recreated on every
// state change.
export function useCommentNavigation(
  inputs: NavigationInputs,
  keyboardShortcutsConfig: KeyboardShortcutsMap,
) {
  const dispatch = useDispatch();

  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const goToNextComment = useCallback(
    (forward: boolean = true) => {
      const { skeletonTracing, sortBy, isSortedAscending } = inputsRef.current;
      const activeNode = getActiveNode(skeletonTracing);
      if (activeNode == null) {
        return;
      }

      const sortAscending = forward ? isSortedAscending : !isSortedAscending;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = getSortedTreesWithComments(skeletonTracing.trees, sortBy, sortAscending);
      const sortedComments = getSortedComments(sortedTrees, sortBy, sortAscending);

      const currentCommentIndex = sortedComments.findIndex(
        (comment) => comment.nodeId === activeNode.id,
      );
      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        dispatch(setActiveNodeAction(sortedComments[nextCommentIndex].nodeId));
      }
    },
    [dispatch],
  );

  const goToPreviousComment = useCallback(() => goToNextComment(false), [goToNextComment]);

  useEffect(() => {
    const keyboardHandlers: Partial<KeyboardShortcutHandlerMap> = {
      NEXT_COMMENT: {
        onPressedWithRepeat: () => goToNextComment(),
        delayed: true,
      },
      PREVIOUS_COMMENT: {
        onPressedWithRepeat: () => goToPreviousComment(),
        delayed: true,
      },
    };
    const keyboardControls = buildKeyBindingsFromConfig(keyboardShortcutsConfig, keyboardHandlers);
    const keyboard = new InputKeyboard(keyboardControls);
    return () => {
      keyboard.destroy();
    };
  }, [keyboardShortcutsConfig, goToNextComment, goToPreviousComment]);

  return { goToNextComment, goToPreviousComment };
}
