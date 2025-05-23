import _ from "lodash";
import type {
  UpdateUserBoundingBoxInSkeletonTracingAction,
  UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/update_actions";
import type { SaveQueueEntry } from "viewer/store";

function removeAllButLastUpdateTracingAction(updateActionsBatches: Array<SaveQueueEntry>) {
  // This part of the code removes all entries from the save queue that consist only of
  // one update{Skeleton,Volume}Tracing update action, except for the last one
  const updateSkeletonTracingOnlyBatches = updateActionsBatches.filter(
    (batch) => batch.actions.length === 1 && batch.actions[0].name === "updateSkeletonTracing",
  );
  const updateVolumeTracingOnlyBatches = updateActionsBatches.filter(
    (batch) => batch.actions.length === 1 && batch.actions[0].name === "updateVolumeTracing",
  );
  return _.without(
    updateActionsBatches,
    ...updateSkeletonTracingOnlyBatches.slice(0, -1),
    ...updateVolumeTracingOnlyBatches.slice(0, -1),
  );
}

function removeAllButLastUpdateTdCameraAction(updateActionsBatches: Array<SaveQueueEntry>) {
  // This part of the code removes all entries from the save queue that consist only of
  // one updateTdCamera update action, except for the last one
  const updateTracingOnlyBatches = updateActionsBatches.filter(
    (batch) => batch.actions.length === 1 && batch.actions[0].name === "updateTdCamera",
  );
  return _.without(updateActionsBatches, ...updateTracingOnlyBatches.slice(0, -1));
}

function removeSubsequentUpdateTreeActions(updateActionsBatches: Array<SaveQueueEntry>) {
  const obsoleteUpdateActions = [];

  // If two updateTree update actions for the same treeId follow one another, the first one is obsolete
  for (let i = 0; i < updateActionsBatches.length - 1; i++) {
    const actions1 = updateActionsBatches[i].actions;
    const actions2 = updateActionsBatches[i + 1].actions;

    if (
      actions1.length === 1 &&
      actions1[0].name === "updateTree" &&
      actions2.length === 1 &&
      actions2[0].name === "updateTree" &&
      actions1[0].value.id === actions2[0].value.id
    ) {
      obsoleteUpdateActions.push(updateActionsBatches[i]);
    }
  }

  return _.without(updateActionsBatches, ...obsoleteUpdateActions);
}

function removeSubsequentUpdateNodeActions(updateActionsBatches: Array<SaveQueueEntry>) {
  const obsoleteUpdateActions = [];

  // If two updateNode update actions for the same nodeId follow one another, the first one is obsolete
  for (let i = 0; i < updateActionsBatches.length - 1; i++) {
    const actions1 = updateActionsBatches[i].actions;
    const actions2 = updateActionsBatches[i + 1].actions;

    if (
      actions1.length === 1 &&
      actions1[0].name === "updateNode" &&
      actions2.length === 1 &&
      actions2[0].name === "updateNode" &&
      actions1[0].value.id === actions2[0].value.id
    ) {
      obsoleteUpdateActions.push(updateActionsBatches[i]);
    }
  }

  return _.without(updateActionsBatches, ...obsoleteUpdateActions);
}

export function removeSubsequentUpdateBBoxActions(updateActionsBatches: Array<SaveQueueEntry>) {
  // Actions are obsolete, if they are for the same bounding box and for the same prop.
  // E.g. when rezising a bounding box, multiple updateActions are sent during the resize, while only the last one is needed.
  const previousActionsById: Record<
    string,
    UpdateUserBoundingBoxInSkeletonTracingAction | UpdateUserBoundingBoxInVolumeTracingAction
  > = {};
  const relevantActions = [];
  for (let i = updateActionsBatches.length - 1; i >= 0; i--) {
    const currentActions = updateActionsBatches[i].actions;
    if (
      currentActions.length === 1 &&
      ["updateUserBoundingBoxInSkeletonTracing", "updateUserBoundingBoxInVolumeTracing"].includes(
        currentActions[0].name,
      )
    ) {
      const currentAction = currentActions[0] as
        | UpdateUserBoundingBoxInSkeletonTracingAction
        | UpdateUserBoundingBoxInVolumeTracingAction;
      const previousActionForTracing = previousActionsById[currentAction.value.actionTracingId];
      if (
        previousActionForTracing != null &&
        previousActionForTracing.name === currentAction.name &&
        previousActionForTracing.value.boundingBoxId === currentAction.value.boundingBoxId &&
        previousActionForTracing.value.hasUpdatedColor === currentAction.value.hasUpdatedColor &&
        previousActionForTracing.value.hasUpdatedName === currentAction.value.hasUpdatedName &&
        previousActionForTracing.value.hasUpdatedBoundingBox ===
          currentAction.value.hasUpdatedBoundingBox
      ) {
        relevantActions.unshift(updateActionsBatches[i]);
      }
      previousActionsById[currentAction.value.actionTracingId] = currentAction;
    } else {
      relevantActions.unshift(updateActionsBatches[i]);
    }
  }
  return relevantActions;
}

function removeSubsequentUpdateSegmentActions(updateActionsBatches: Array<SaveQueueEntry>) {
  const obsoleteUpdateActions = [];

  // If two updateSegment update actions for the same segment id follow one another, the first one is obsolete
  for (let i = 0; i < updateActionsBatches.length - 1; i++) {
    const actions1 = updateActionsBatches[i].actions;
    const actions2 = updateActionsBatches[i + 1].actions;

    if (
      actions1.length === 1 &&
      actions1[0].name === "updateSegment" &&
      actions2.length === 1 &&
      actions2[0].name === "updateSegment" &&
      actions1[0].value.id === actions2[0].value.id
    ) {
      obsoleteUpdateActions.push(updateActionsBatches[i]);
    }
  }

  return _.without(updateActionsBatches, ...obsoleteUpdateActions);
}

const compactAll = _.flow([
  removeAllButLastUpdateTracingAction,
  removeAllButLastUpdateTdCameraAction,
  removeSubsequentUpdateNodeActions,
  removeSubsequentUpdateTreeActions,
  removeSubsequentUpdateSegmentActions,
  removeSubsequentUpdateBBoxActions,
]);

export default function compactSaveQueue(
  updateActionsBatches: Array<SaveQueueEntry>,
): Array<SaveQueueEntry> {
  // Remove empty batches
  const result = updateActionsBatches.filter(
    (updateActionsBatch) => updateActionsBatch.actions.length > 0,
  );

  return compactAll(result);
}
