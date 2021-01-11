// @flow

import _ from "lodash";

import type { SaveQueueEntry } from "oxalis/store";

function removeAllButLastUpdateTracingAction(updateActionsBatches: Array<SaveQueueEntry>) {
  // This part of the code removes all entries from the save queue that consist only of
  // one updateTracing update action, except for the last one
  const updateTracingOnlyBatches = updateActionsBatches.filter(
    batch => batch.actions.length === 1 && batch.actions[0].name === "updateTracing",
  );
  return _.without(updateActionsBatches, ...updateTracingOnlyBatches.slice(0, -1));
}

function removeAllButLastUpdateTdCameraAction(updateActionsBatches: Array<SaveQueueEntry>) {
  // This part of the code removes all entries from the save queue that consist only of
  // one updateTdCamera update action, except for the last one
  const updateTracingOnlyBatches = updateActionsBatches.filter(
    batch => batch.actions.length === 1 && batch.actions[0].name === "updateTdCamera",
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

export default function compactSaveQueue(
  updateActionsBatches: Array<SaveQueueEntry>,
): Array<SaveQueueEntry> {
  // Remove empty batches
  const result = updateActionsBatches.filter(
    updateActionsBatch => updateActionsBatch.actions.length > 0,
  );

  return removeSubsequentUpdateTreeActions(
    removeSubsequentUpdateNodeActions(
      removeAllButLastUpdateTdCameraAction(removeAllButLastUpdateTracingAction(result)),
    ),
  );
}
