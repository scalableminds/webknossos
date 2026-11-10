import type { Vector3 } from "viewer/constants";
import type { ServerAgglomerateGraphDiff } from "viewer/model/helpers/proto_helpers";
import type { AgglomerateDiffDescriptor } from "viewer/store";

export type RequestAgglomerateDiffAction = ReturnType<typeof requestAgglomerateDiffAction>;
type FinishLoadingAgglomerateDiffAction = ReturnType<typeof finishLoadingAgglomerateDiffAction>;
type FailLoadingAgglomerateDiffAction = ReturnType<typeof failLoadingAgglomerateDiffAction>;
type RemoveAgglomerateDiffsAction = ReturnType<typeof removeAgglomerateDiffsAction>;
type StopAwaitingAgglomerateSkeletonAction = ReturnType<
  typeof stopAwaitingAgglomerateSkeletonAction
>;
type SyncAgglomerateDiffsWithSourceTreesAction = ReturnType<
  typeof syncAgglomerateDiffsWithSourceTreesAction
>;

export type AgglomerateDiffAction =
  | RequestAgglomerateDiffAction
  | FinishLoadingAgglomerateDiffAction
  | FailLoadingAgglomerateDiffAction
  | RemoveAgglomerateDiffsAction
  | StopAwaitingAgglomerateSkeletonAction
  | SyncAgglomerateDiffsWithSourceTreesAction;

// None of these actions change the annotation. The diffs are only kept locally.

// Marks the diff as loading and lets the agglomerate_diff_saga load it. The agglomerate is compared
// to the reference agglomerate that contains the segment at the given position (in the coordinate
// system of the layer). The position is floored, so that it can be compared to the clicked position
// stored with the agglomerate skeleton (see createAgglomerateSkeletonMetadata).
// awaitsAgglomerateSkeleton has to be set if the diff is requested while its agglomerate skeleton is
// still loading. Otherwise, the diff would be considered obsolete. In case the agglomerate skeleton
// cannot be added, the requester has to remove the diff. Otherwise, it has to dispatch
// stopAwaitingAgglomerateSkeletonAction once the agglomerate skeleton was added.
export const requestAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  positionInLayer: Vector3,
  awaitsAgglomerateSkeleton: boolean,
) =>
  ({
    type: "REQUEST_AGGLOMERATE_DIFF",
    descriptor,
    positionInLayer: positionInLayer.map(Math.floor) as Vector3,
    awaitsAgglomerateSkeleton,
  }) as const;

// The position is the one of the request (see requestAgglomerateDiffAction). The result is ignored
// if the diff was requested again for a different position in the meantime.
export const finishLoadingAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  positionInLayer: Vector3,
  diff: ServerAgglomerateGraphDiff,
) =>
  ({
    type: "FINISH_LOADING_AGGLOMERATE_DIFF",
    descriptor,
    positionInLayer,
    diff,
  }) as const;

// A failed diff is not requested again until it becomes obsolete.
export const failLoadingAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  positionInLayer: Vector3,
  errorMessage: string,
) =>
  ({
    type: "FAIL_LOADING_AGGLOMERATE_DIFF",
    descriptor,
    positionInLayer,
    errorMessage,
  }) as const;

export const removeAgglomerateDiffsAction = (keys: Array<string>) =>
  ({
    type: "REMOVE_AGGLOMERATE_DIFFS",
    keys,
  }) as const;

// Has to be dispatched by the requester of a diff that awaits its agglomerate skeleton (see
// requestAgglomerateDiffAction) once that skeleton was added. Usually, the diff stopped awaiting
// already (see syncAgglomerateDiffsWithSourceTreesAction). But if the diff is not desired anymore
// (e.g., because the reference mapping changed while the skeleton was loading), it would be kept
// forever otherwise.
export const stopAwaitingAgglomerateSkeletonAction = (key: string) =>
  ({
    type: "STOP_AWAITING_AGGLOMERATE_SKELETON",
    key,
  }) as const;

// Updates the diffs whose agglomerate skeletons exist (keyed by getAgglomerateDiffKey) with the
// id of these agglomerate skeletons and whether the diffs are shown (only while their agglomerate
// skeleton is visible and their layer is enabled). Also, these diffs don't await their agglomerate
// skeleton anymore.
export const syncAgglomerateDiffsWithSourceTreesAction = (
  sourceTreeByKey: Record<string, { treeId: number; isShown: boolean }>,
) =>
  ({
    type: "SYNC_AGGLOMERATE_DIFFS_WITH_SOURCE_TREES",
    sourceTreeByKey,
  }) as const;
