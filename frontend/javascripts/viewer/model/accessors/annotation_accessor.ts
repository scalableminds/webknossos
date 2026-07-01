import size from "lodash-es/size";
import type {
  APIAnnotationInfo,
  APIAnnotationUserState,
  APIUserBase,
  SkeletonUserState,
  VolumeUserState,
} from "types/api_types";
import type { EmptyObject } from "types/type_utils";
import { TreeTypeEnum } from "viewer/constants";
import type { Tree } from "viewer/model/types/tree_types";
import type { StoreAnnotation, WebknossosState } from "viewer/store";
import { sum } from "../helpers/iterator_utils";

export function mayEditAnnotationProperties(state: WebknossosState) {
  const { owner, restrictions } = state.annotation;
  const activeUser = state.activeUser;

  return !!(
    restrictions.allowUpdate &&
    restrictions.allowSave &&
    activeUser &&
    owner?.id === activeUser.id &&
    !state.annotation.isLockedByOwner
  );
}

export function mayEditAnnotation(state: WebknossosState) {
  // The following properties can/should be *ignored*:
  // - isLockedByOwner
  //   - because isUpdatingCurrentlyAllowed is initialized while respecting
  //     annotation.restrictions.allowUpdate (which in turn respects isLockedByOwner).
  // - showVersionRestore
  //   - because isUpdatingCurrentlyAllowed will be set to false while the version view is open
  // - annotation.restrictions.allowSave
  //   - because in sandbox mode, one can edit things but not save them
  //
  // isUpdatingCurrentlyAllowed itself is initialized using the backend-provided
  // allowUpdate value (so, it contains ownership/permission checks).
  // The frontend updates isUpdatingCurrentlyAllowed when collaboration mode, mutex ownership
  // and other factors (mainly, opened version restore view) change.
  return state.annotation.isUpdatingCurrentlyAllowed;
}

export function mayAddToSaveQueue(state: WebknossosState): boolean {
  /*
   * This function is used to answer whether we may diff the current
   * annotation state with the previous one to fill the save queue
   * with update actions.
   */
  return (
    // allowSave is initialized with allowUpdate and may be overridden when
    // saving is disabled (via DISABLE_SAVING action).
    Boolean(state.annotation.restrictions.allowSave) &&
    !state.uiInformation.showVersionRestore &&
    // The mayEditAnnotation accessor should prevent "proper" modifications to the annotation.
    // However, view-related changes (e.g., camera movement) are still allowed and are
    // stored in the annotation. Therefore, we still need to check isUpdatingCurrentlyAllowed
    // to avoid that those changes are tried to be saved.
    state.annotation.isUpdatingCurrentlyAllowed &&
    // Ignore changes while rebasing or forwarding new backend actions as during this time actions
    // are simply replayed on top of the server's state.
    // Therefore, these actions were already added to the save queue or originate from the server itself
    // and should not be added again.
    !state.save.rebaseRelevantServerAnnotationState.isRebasingOrForwarding
  );
}

export function maySendSaveRequest(state: WebknossosState) {
  /*
   * This function is used to answer whether we may send the current content of the
   * save queue to the server.
   * The implementation is currently identical to mayAddToSaveQueue, but the reasoning
   * is a bit different and also the implementations might diverge in the future.
   */

  return Boolean(
    state.annotation.restrictions.allowSave &&
      (!state.uiInformation.showVersionRestore || state.uiInformation.isRestoringVersion) &&
      // Ignore changes while rebasing or forwarding as this manipulates the save queue
      // (and for sending save requests, we also manipulate the save queue).
      !state.save.rebaseRelevantServerAnnotationState.isRebasingOrForwarding,
  );
}

export function isConcurrentCollaborationMode(state: WebknossosState) {
  // "Live collaboration" / "simultaneous editing": multiple users edit the same
  // annotation at the same time. In this mode, normal skeleton editing is forbidden
  // because it would interfere with concurrent edits/rebasing. Only proofreading
  // (which operates on agglomerate trees) is allowed.
  return state.annotation.collaborationMode === "Concurrent";
}

export function isAgglomerateTree(tree: Tree | null | undefined): boolean {
  return tree?.type === TreeTypeEnum.AGGLOMERATE;
}

export function mayEditSkeletonTree(state: WebknossosState, tree: Tree | null | undefined) {
  // Whether the given existing tree may be mutated. In concurrent collaboration
  // mode, only agglomerate trees (i.e. proofreading) may be edited.
  if (!mayEditAnnotation(state)) {
    return false;
  }
  if (!isConcurrentCollaborationMode(state)) {
    return true;
  }
  return isAgglomerateTree(tree);
}

export function mayEditAnnotationViewConfig(state: WebknossosState) {
  // All users that are allowed to update the annotation have their own view
  // config and can thus update it. This is independent of the collaboration
  // mode and annotation mutexes.
  return state.annotation.restrictions.allowUpdate;
}

export function isAnnotationOwner(state: WebknossosState) {
  const activeUser = state.activeUser;
  const owner = state.annotation.owner;

  return !!(activeUser && owner?.id === activeUser.id);
}

export function isAnnotationFromDifferentOrganization(state: WebknossosState) {
  const activeUser = state.activeUser;

  return !!(activeUser && activeUser?.organization !== state.annotation.organization);
}

export function isAnnotationEditableByNonOwners(annotation: StoreAnnotation | APIAnnotationInfo) {
  return annotation.collaborationMode !== "OwnerOnly";
}

export type SkeletonTracingStats = {
  treeCount: number;
  nodeCount: number;
  edgeCount: number;
  branchPointCount: number;
};

export type VolumeTracingStats = {
  segmentCount: number;
};

export type TracingStats = Record<string, SkeletonTracingStats | VolumeTracingStats | EmptyObject>;

export function getStats(annotation: StoreAnnotation): TracingStats {
  const stats: TracingStats = {};
  const { skeleton, volumes } = annotation;
  for (const volumeTracing of volumes) {
    stats[volumeTracing.tracingId] = { segmentCount: volumeTracing.segments.size() };
  }
  if (skeleton) {
    stats[skeleton.tracingId] = {
      treeCount: skeleton.trees.size(),
      nodeCount: sum(skeleton.trees.values().map((tree) => tree.nodes.size())),
      edgeCount: sum(skeleton.trees.values().map((tree) => tree.edges.size())),
      branchPointCount: sum(skeleton.trees.values().map((tree) => size(tree.branchPoints))),
    };
  }
  return stats;
}

export function getCreationTimestamp(annotation: StoreAnnotation) {
  let timestamp = annotation.skeleton?.createdTimestamp;
  for (const volumeTracing of annotation.volumes) {
    if (!timestamp || volumeTracing.createdTimestamp < timestamp) {
      timestamp = volumeTracing.createdTimestamp;
    }
  }
  return timestamp || 0;
}

export function getSkeletonStats(stats: TracingStats): SkeletonTracingStats | undefined {
  for (const tracingId in stats) {
    if ("treeCount" in stats[tracingId]) {
      // TS thinks the return value could be EmptyObject even though
      // we just checked that treeCount is a property.
      return stats[tracingId] as SkeletonTracingStats;
    }
  }
  return undefined;
}

export function getVolumeStats(stats: TracingStats): [string, VolumeTracingStats][] {
  return Object.entries(stats).filter(([_tracingId, stat]) => "segmentCount" in stat) as [
    string,
    VolumeTracingStats,
  ][];
}

export function getUserStateForTracing<
  T extends APIAnnotationUserState | VolumeUserState | SkeletonUserState,
>(
  tracing: { userStates: T[] },
  activeUser: APIUserBase | null | undefined,
  owner: APIUserBase | null | undefined,
): T | undefined {
  let userState: T | undefined;
  if (activeUser) {
    userState = tracing.userStates.find((state) => state.userId === activeUser.id);
    if (userState) {
      return userState;
    }
  }

  if (owner) {
    userState = tracing.userStates.find((state) => state.userId === owner.id);
    if (userState) {
      return userState;
    }
  }

  return undefined;
}

export function isSaving(state: WebknossosState): boolean {
  return state.operationContext.activeOperations
    .concat(state.operationContext.childOperations)
    .some((op) => op.id === "SAVE");
}

export function isSavingOrRebasing(state: WebknossosState): boolean {
  return isSaving(state) || state.save.rebaseRelevantServerAnnotationState.isRebasingOrForwarding;
}

export function isUserInterfaceBlocked(state: WebknossosState): boolean {
  if (!mayEditAnnotation(state)) {
    // The user is not allowed to edit the annotation, anyway. No need to block the UI
    // (would also be annoying because it would turn the cursor into a spinner when the
    // annotation is updating to remote changes).
    return false;
  }

  const { activeOperations } = state.operationContext;
  if (activeOperations.length === 0) {
    // No operation is going on anyway.
    return false;
  }
  if (state.annotation.collaborationMode !== "Concurrent") {
    // The current user is the only one that is allowed to edit the annotation currently.
    // If the only active operation is a save operation, the UI should not be blocked.
    // Reminder: in concurrent collab mode, we forbid users from editing during saving
    // because editing would interfere with rebase operations.
    const isOnlySaveOperation = activeOperations.length === 1 && activeOperations[0].id === "SAVE";
    return !isOnlySaveOperation;
  }
  // At least one operation is ongoing and should block the user.
  return true;
}
