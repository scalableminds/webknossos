import { useCallback } from "react";
import { useDispatch } from "react-redux";
import {
  createCommentAction,
  deleteCommentAction,
} from "viewer/model/actions/skeletontracing_actions";

/*
 * Mutations for the active node's comment. Saving an empty string deletes the
 * comment, otherwise it is created/updated.
 */
export function useCommentMutations(): { saveComment: (content: string) => void } {
  const dispatch = useDispatch();

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

  return { saveComment };
}
