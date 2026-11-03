import type { Vector3 } from "viewer/constants";
import type { ServerAgglomerateGraphDiff } from "viewer/model/helpers/proto_helpers";
import type { AgglomerateDiffDescriptor } from "viewer/store";

export type RequestAgglomerateDiffAction = ReturnType<typeof requestAgglomerateDiffAction>;
type FinishLoadingAgglomerateDiffAction = ReturnType<typeof finishLoadingAgglomerateDiffAction>;
type FailLoadingAgglomerateDiffAction = ReturnType<typeof failLoadingAgglomerateDiffAction>;
type RemoveAgglomerateDiffsAction = ReturnType<typeof removeAgglomerateDiffsAction>;
type SetAgglomerateDiffsVisibilityAction = ReturnType<typeof setAgglomerateDiffsVisibilityAction>;
type SyncAgglomerateDiffsWithSourceTreesAction = ReturnType<
  typeof syncAgglomerateDiffsWithSourceTreesAction
>;

export type AgglomerateDiffAction =
  | RequestAgglomerateDiffAction
  | FinishLoadingAgglomerateDiffAction
  | FailLoadingAgglomerateDiffAction
  | RemoveAgglomerateDiffsAction
  | SetAgglomerateDiffsVisibilityAction
  | SyncAgglomerateDiffsWithSourceTreesAction;

// None of these actions change the annotation. The diffs are only kept locally.

// Marks the diff as loading and lets the agglomerate_diff_saga load it. The agglomerate is compared
// to the reference agglomerate that contains the segment at the given position (in the coordinate
// system of the layer). awaitsAgglomerateSkeleton has to be set if the diff is requested while its
// agglomerate skeleton is still loading. Otherwise, the diff would be considered obsolete. In case
// the agglomerate skeleton cannot be added, the requester has to remove the diff.
export const requestAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  positionInLayer: Vector3,
  awaitsAgglomerateSkeleton: boolean,
) =>
  ({
    type: "REQUEST_AGGLOMERATE_DIFF",
    descriptor,
    positionInLayer,
    awaitsAgglomerateSkeleton,
  }) as const;

export const finishLoadingAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  diff: ServerAgglomerateGraphDiff,
) =>
  ({
    type: "FINISH_LOADING_AGGLOMERATE_DIFF",
    descriptor,
    diff,
  }) as const;

// A failed diff is not requested again until it becomes obsolete.
export const failLoadingAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  errorMessage: string,
) =>
  ({
    type: "FAIL_LOADING_AGGLOMERATE_DIFF",
    descriptor,
    errorMessage,
  }) as const;

export const removeAgglomerateDiffsAction = (keys: Array<string>) =>
  ({
    type: "REMOVE_AGGLOMERATE_DIFFS",
    keys,
  }) as const;

export const setAgglomerateDiffsVisibilityAction = (isVisible: boolean) =>
  ({
    type: "SET_AGGLOMERATE_DIFFS_VISIBILITY",
    isVisible,
  }) as const;

// Updates the diffs whose agglomerate skeletons exist (keyed by getAgglomerateDiffKey) with the
// id and visibility of these agglomerate skeletons, as diffs are only shown while their agglomerate
// skeleton is visible. Also, these diffs don't await their agglomerate skeleton anymore.
export const syncAgglomerateDiffsWithSourceTreesAction = (
  sourceTreeByKey: Record<string, { treeId: number; isVisible: boolean }>,
) =>
  ({
    type: "SYNC_AGGLOMERATE_DIFFS_WITH_SOURCE_TREES",
    sourceTreeByKey,
  }) as const;
