import _ from "lodash";
import type { SaveQueueEntry } from "oxalis/store";

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

function removeSubsequentUpdateBBoxActions(updateActionsBatches: Array<SaveQueueEntry>) {
  const obsoleteUpdateActions = [];

  // Actions are obsolete, if they are for the same bounding box and for the same prop.
  // The given action is always compared to the next next one, as usually an
  // updateUserBoundingBoxInSkeletonTracingAction and updateUserBoundingBoxInVolumeTracingAction
  // is sent at the same time.
  for (let i = 0; i < updateActionsBatches.length - 2; i++) {
    const actions1 = updateActionsBatches[i].actions;
    const actions2 = updateActionsBatches[i + 2].actions;

    if (
      actions1.length === 1 &&
      actions2.length === 1 &&
      (actions1[0].name === "updateUserBoundingBoxInSkeletonTracing" ||
        actions1[0].name === "updateUserBoundingBoxInVolumeTracing") &&
      actions1[0].name === actions2[0].name &&
      actions1[0].value.boundingBoxId === actions2[0].value.boundingBoxId &&
      _.isEqual(actions1[0].value.updatedPropKeys, actions2[0].value.updatedPropKeys)
    ) {
      obsoleteUpdateActions.push(updateActionsBatches[i]);
      console.log(
        actions1[0].value.boundingBoxId,
        actions1[0].value.updatedProps,
        actions2[0].value.boundingBoxId,
        actions2[0].value.updatedProps,
      ); // TODO_c remove
    }
  }

  return _.without(updateActionsBatches, ...obsoleteUpdateActions);
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

export default function compactSaveQueue(
  updateActionsBatches: Array<SaveQueueEntry>,
): Array<SaveQueueEntry> {
  // Remove empty batches
  const result = updateActionsBatches.filter(
    (updateActionsBatch) => updateActionsBatch.actions.length > 0,
  );

  return removeSubsequentUpdateBBoxActions(
    removeSubsequentUpdateSegmentActions(
      removeSubsequentUpdateTreeActions(
        removeSubsequentUpdateNodeActions(
          removeAllButLastUpdateTdCameraAction(removeAllButLastUpdateTracingAction(result)),
        ),
      ),
    ),
  );
}
