import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { isAnnotationOwner, mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  createCommentAction,
  deleteCommentAction,
} from "viewer/model/actions/skeletontracing_actions";
import { useActiveComment } from "./use_active_comment";

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
