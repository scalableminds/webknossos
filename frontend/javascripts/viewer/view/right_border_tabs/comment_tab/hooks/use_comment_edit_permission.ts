import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { isAnnotationOwner, mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";

/*
 * Whether the active node's comment may currently be edited, and — if not — the
 * reason to surface in a tooltip. Editing requires an active node and an
 * annotation the user is allowed to update.
 */
export function useCommentEditPermission(): { isDisabled: boolean; disabledReason: string | null } {
  const activeNodeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeNodeId ?? null,
  );
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector(isAnnotationOwner);

  return {
    isDisabled: activeNodeId == null || !allowUpdate,
    disabledReason: allowUpdate
      ? null
      : messages["tracing.read_only_mode_notification"](isLockedByOwner, isOwner),
  };
}
