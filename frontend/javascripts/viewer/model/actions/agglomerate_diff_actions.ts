import type { ServerSkeletonTracingTree } from "types/api_types";
import type { AgglomerateDiffDescriptor } from "viewer/store";

export type LoadedAgglomerateDiff = {
  // The segment of the agglomerate whose reference agglomerate was compared
  segmentId: bigint;
  referenceAgglomerateId: bigint | null;
  trees: Array<ServerSkeletonTracingTree>;
};

type StartLoadingAgglomerateDiffAction = ReturnType<typeof startLoadingAgglomerateDiffAction>;
type FinishLoadingAgglomerateDiffAction = ReturnType<typeof finishLoadingAgglomerateDiffAction>;
type RemoveAgglomerateDiffsAction = ReturnType<typeof removeAgglomerateDiffsAction>;
type SetAgglomerateDiffsVisibilityAction = ReturnType<typeof setAgglomerateDiffsVisibilityAction>;

export type AgglomerateDiffAction =
  | StartLoadingAgglomerateDiffAction
  | FinishLoadingAgglomerateDiffAction
  | RemoveAgglomerateDiffsAction
  | SetAgglomerateDiffsVisibilityAction;

// None of these actions change the annotation. The diffs are only kept locally.
export const startLoadingAgglomerateDiffAction = (descriptor: AgglomerateDiffDescriptor) =>
  ({
    type: "START_LOADING_AGGLOMERATE_DIFF",
    descriptor,
  }) as const;

// Passing null as diff marks the diff as failed, so that it is not requested again.
export const finishLoadingAgglomerateDiffAction = (
  descriptor: AgglomerateDiffDescriptor,
  diff: LoadedAgglomerateDiff | null,
) =>
  ({
    type: "FINISH_LOADING_AGGLOMERATE_DIFF",
    descriptor,
    diff,
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
