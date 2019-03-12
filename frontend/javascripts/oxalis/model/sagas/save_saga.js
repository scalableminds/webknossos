/*
 * save_saga.js
 * @flow
 */

import { type Saga, delay } from "redux-saga";
import Maybe from "data.maybe";
import _ from "lodash";

import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import type { Tracing, Flycam, SaveQueueEntry } from "oxalis/store";
import { type UpdateAction, moveTreeComponent } from "oxalis/model/sagas/update_actions";
import { VolumeTracingSaveRelevantActions } from "oxalis/model/actions/volumetracing_actions";
import {
  _all,
  take,
  _take,
  _call,
  race,
  call,
  put,
  select,
} from "oxalis/model/sagas/effect-generators";
import {
  createTreeAction,
  SkeletonTracingSaveRelevantActions,
  setTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";
import { doWithToken } from "admin/admin_rest_api";
import {
  shiftSaveQueueAction,
  setSaveBusyAction,
  setLastSaveTimestampAction,
  pushSaveQueueAction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import Date from "libs/date";
import Request, { type RequestOptionsWithData } from "libs/request";
import Toast from "libs/toast";
import messages from "messages";
import window, { alert, document, location } from "libs/window";
import { getUid } from "libs/uid_generator";

import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";

const PUSH_THROTTLE_TIME = 30000; // 30s
const SAVE_RETRY_WAITING_TIME = 2000;
const MAX_SAVE_RETRY_WAITING_TIME = 300000; // 5m
const UNDO_HISTORY_SIZE = 20;

export const maximumActionCountPerBatch = 5000;
const maximumActionCountPerSave = 15000;

export function* collectUndoStates(): Saga<void> {
  const undoStack = [];
  const redoStack = [];

  yield* take("INITIALIZE_SKELETONTRACING");
  let prevTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  while (true) {
    const { userAction, undo, redo } = yield* race({
      userAction: _take(SkeletonTracingSaveRelevantActions),
      undo: _take("UNDO"),
      redo: _take("REDO"),
    });
    const curTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
    if (userAction) {
      if (curTracing !== prevTracing) {
        // Clear the redo stack when a new action is executed
        redoStack.splice(0);
        undoStack.push(prevTracing);
        if (undoStack.length > UNDO_HISTORY_SIZE) undoStack.shift();
      }
    } else if (undo) {
      if (undoStack.length) {
        redoStack.push(prevTracing);
        const newTracing = undoStack.pop();
        yield* put(setTracingAction(newTracing));
      } else {
        Toast.info(messages["undo.no_undo"]);
      }
    } else if (redo) {
      if (redoStack.length) {
        undoStack.push(prevTracing);
        const newTracing = redoStack.pop();
        yield* put(setTracingAction(newTracing));
      } else {
        Toast.info(messages["undo.no_redo"]);
      }
    }
    // We need the updated tracing here
    prevTracing = yield* select(state => enforceSkeletonTracing(state.tracing));
  }
}

export function* pushAnnotationAsync(): Saga<void> {
  yield _all([_call(pushTracingTypeAsync, "skeleton"), _call(pushTracingTypeAsync, "volume")]);
}

export function* pushTracingTypeAsync(tracingType: "skeleton" | "volume"): Saga<void> {
  yield* take(
    tracingType === "skeleton" ? "INITIALIZE_SKELETONTRACING" : "INITIALIZE_VOLUMETRACING",
  );
  yield* put(setLastSaveTimestampAction(tracingType));
  while (true) {
    let saveQueue;
    // Check whether the save queue is actually empty, the PUSH_SAVE_QUEUE action
    // could have been triggered during the call to sendRequestToServer

    saveQueue = yield* select(state => state.save.queue[tracingType]);
    if (saveQueue.length === 0) {
      // Save queue is empty, wait for push event
      yield* take("PUSH_SAVE_QUEUE");
    }
    yield* race({
      timeout: _call(delay, PUSH_THROTTLE_TIME),
      forcePush: _take("SAVE_NOW"),
    });
    yield* put(setSaveBusyAction(true, tracingType));
    while (true) {
      // Send batches to the server until the save queue is empty
      saveQueue = yield* select(state => state.save.queue[tracingType]);
      if (saveQueue.length > 0) {
        yield* call(sendRequestToServer, tracingType);
      } else {
        break;
      }
    }
    yield* put(setSaveBusyAction(false, tracingType));
  }
}

export function sendRequestWithToken(
  urlWithoutToken: string,
  data: RequestOptionsWithData<Array<SaveQueueEntry>>,
): Promise<*> {
  return doWithToken(token => Request.sendJSONReceiveJSON(`${urlWithoutToken}${token}`, data));
}

// This function returns the first n batches of the provided array, so that the count of
// all actions in these n batches does not exceed maximumActionCountPerSave
function sliceAppropriateBatchCount(batches: Array<SaveQueueEntry>): Array<SaveQueueEntry> {
  const slicedBatches = [];
  let actionCount = 0;

  for (const batch of batches) {
    const newActionCount = actionCount + batch.actions.length;
    if (newActionCount <= maximumActionCountPerSave) {
      actionCount = newActionCount;
      slicedBatches.push(batch);
    } else {
      break;
    }
  }

  return slicedBatches;
}

function getRetryWaitTime(retryCount: number) {
  // Exponential backoff up until MAX_SAVE_RETRY_WAITING_TIME
  return Math.min(2 ** retryCount * SAVE_RETRY_WAITING_TIME, MAX_SAVE_RETRY_WAITING_TIME);
}

export function* sendRequestToServer(tracingType: "skeleton" | "volume"): Saga<void> {
  const fullSaveQueue = yield* select(state => state.save.queue[tracingType]);
  const saveQueue = sliceAppropriateBatchCount(fullSaveQueue);

  let compactedSaveQueue = compactSaveQueue(saveQueue);
  const { version, type, tracingId } = yield* select(state =>
    Maybe.fromNullable(state.tracing[tracingType]).get(),
  );
  const tracingStoreUrl = yield* select(state => state.tracing.tracingStore.url);
  compactedSaveQueue = addVersionNumbers(compactedSaveQueue, version);

  compactedSaveQueue = addRequestIds(compactedSaveQueue, getUid());

  let retryCount = 0;
  while (true) {
    try {
      yield* call(
        sendRequestWithToken,
        `${tracingStoreUrl}/tracings/${type}/${tracingId}/update?token=`,
        {
          method: "POST",
          headers: { "X-Date": `${Date.now()}` },
          data: compactedSaveQueue,
          compress: true,
        },
      );
      yield* put(setVersionNumberAction(version + compactedSaveQueue.length, tracingType));
      yield* put(setLastSaveTimestampAction(tracingType));
      yield* put(shiftSaveQueueAction(saveQueue.length, tracingType));
      yield* call(toggleErrorHighlighting, false);
      return;
    } catch (error) {
      yield* call(toggleErrorHighlighting, true);
      if (error.status === 409) {
        // HTTP Code 409 'conflict' for dirty state
        window.onbeforeunload = null;
        yield* call(alert, messages["save.failed_simultaneous_tracing"]);
        location.reload();
        return;
      }
      yield* race({
        timeout: _call(delay, getRetryWaitTime(retryCount)),
        forcePush: _take("SAVE_NOW"),
      });
      retryCount++;
    }
  }
}

export function toggleErrorHighlighting(state: boolean): void {
  if (document.body != null) {
    document.body.classList.toggle("save-error", state);
  }
  if (state) {
    Toast.error(messages["save.failed"], { sticky: true });
  } else {
    Toast.close(messages["save.failed"]);
  }
}

export function addVersionNumbers(
  updateActionsBatches: Array<SaveQueueEntry>,
  lastVersion: number,
): Array<SaveQueueEntry> {
  return updateActionsBatches.map(batch => Object.assign({}, batch, { version: ++lastVersion }));
}

export function addRequestIds(
  updateActionsBatches: Array<SaveQueueEntry>,
  requestId: string,
): Array<SaveQueueEntry> {
  return updateActionsBatches.map(batch => Object.assign({}, batch, { requestId }));
}

function removeUnrelevantUpdateActions(updateActions: Array<UpdateAction>) {
  // This functions removes update actions that should not be sent to the server.
  return updateActions.filter(ua => ua.name !== "toggleTree");
}
// The Cantor pairing function assigns one natural number to each pair of natural numbers
function cantor(a, b) {
  return 0.5 * (a + b) * (a + b + 1) + b;
}

function compactMovedNodesAndEdges(updateActions: Array<UpdateAction>) {
  // This function detects tree merges and splits.
  // It does so by identifying nodes and edges that were deleted in one tree only to be created
  // in another tree again afterwards.
  // It replaces the original deleteNode/createNode and deleteEdge/createEdge update actions
  // with a moveTreeComponent update action.
  // As one tree split can produce multiple new trees (if a branchpoint is deleted), the moved nodes
  // and edges have to be grouped by their old and new treeId. Then one moveTreeComponent update action
  // is inserted for each group, containing the respective moved node ids.
  // The exact spot where the moveTreeComponent update action is inserted is important. This is
  // described later.
  let compactedActions = [...updateActions];
  // Detect moved nodes and edges
  const movedNodesAndEdges = [];

  // Performance improvement: create a map of the deletedNode update actions, key is the nodeId
  const deleteNodeActionsMap = _.keyBy(updateActions, ua =>
    ua.name === "deleteNode" ? ua.value.nodeId : -1,
  );
  // Performance improvement: create a map of the deletedEdge update actions, key is the cantor pairing
  // of sourceId and targetId
  const deleteEdgeActionsMap = _.keyBy(updateActions, ua =>
    ua.name === "deleteEdge" ? cantor(ua.value.source, ua.value.target) : -1,
  );
  for (const createUA of updateActions) {
    if (createUA.name === "createNode") {
      const deleteUA = deleteNodeActionsMap[createUA.value.id];
      if (
        deleteUA != null &&
        deleteUA.name === "deleteNode" &&
        deleteUA.value.treeId !== createUA.value.treeId
      ) {
        movedNodesAndEdges.push([createUA, deleteUA]);
      }
    } else if (createUA.name === "createEdge") {
      const deleteUA = deleteEdgeActionsMap[cantor(createUA.value.source, createUA.value.target)];
      if (
        deleteUA != null &&
        deleteUA.name === "deleteEdge" &&
        deleteUA.value.treeId !== createUA.value.treeId
      ) {
        movedNodesAndEdges.push([createUA, deleteUA]);
      }
    }
  }

  // Group moved nodes and edges by their old and new treeId using the cantor pairing function
  // to create a single unique id
  const groupedMovedNodesAndEdges = _.groupBy(movedNodesAndEdges, ([createUA, deleteUA]) =>
    cantor(createUA.value.treeId, deleteUA.value.treeId),
  );

  // Create a moveTreeComponent update action for each of the groups and insert it at the right spot
  for (const movedPairings of _.values(groupedMovedNodesAndEdges)) {
    const oldTreeId = movedPairings[0][1].value.treeId;
    const newTreeId = movedPairings[0][0].value.treeId;
    // This could be done with a .filter(...).map(...), but flow cannot comprehend that
    const nodeIds = movedPairings.reduce((agg, [createUA]) => {
      if (createUA.name === "createNode") agg.push(createUA.value.id);
      return agg;
    }, []);
    // The moveTreeComponent update action needs to be placed:
    // BEFORE the possible deleteTree update action of the oldTreeId and
    // AFTER the possible createTree update action of the newTreeId
    const deleteTreeUAIndex = compactedActions.findIndex(
      ua => ua.name === "deleteTree" && ua.value.id === oldTreeId,
    );
    const createTreeUAIndex = compactedActions.findIndex(
      ua => ua.name === "createTree" && ua.value.id === newTreeId,
    );

    if (deleteTreeUAIndex > -1 && createTreeUAIndex > -1) {
      // This should not happen, but in case it does, the moveTreeComponent update action
      // cannot be inserted as the createTreeUA is after the deleteTreeUA
      // Skip the removal of the original create/delete update actions!
      continue;
    } else if (createTreeUAIndex > -1) {
      // Insert after the createTreeUA
      compactedActions.splice(
        createTreeUAIndex + 1,
        0,
        moveTreeComponent(oldTreeId, newTreeId, nodeIds),
      );
    } else if (deleteTreeUAIndex > -1) {
      // Insert before the deleteTreeUA
      compactedActions.splice(
        deleteTreeUAIndex,
        0,
        moveTreeComponent(oldTreeId, newTreeId, nodeIds),
      );
    } else {
      // Insert in front
      compactedActions.unshift(moveTreeComponent(oldTreeId, newTreeId, nodeIds));
    }

    // Remove the original create/delete update actions of the moved nodes and edges
    // Call _.without with chunks to avoid Call Stack Size Exceeded errors due to the arguments spread
    const movedPairingsChunks = _.chunk(movedPairings, 50000);
    for (const pairingsChunk of movedPairingsChunks) {
      compactedActions = _.without(compactedActions, ..._.flatten(pairingsChunk));
    }
  }

  return compactedActions;
}

function compactDeletedTrees(updateActions: Array<UpdateAction>) {
  // This function detects deleted trees.
  // Instead of sending deleteNode/deleteEdge update actions for all nodes of a deleted tree,
  // just one deleteTree update action is sufficient for the server to delete the tree.
  // As the deleteTree update action is already part of the update actions if a tree is deleted,
  // all corresponding deleteNode/deleteEdge update actions can simply be removed.

  // TODO: Remove the check in map once Flow recognizes that the result of the filter contains only deleteTree update actions
  const deletedTreeIds = updateActions
    .filter(ua => ua.name === "deleteTree")
    .map(ua => (ua.name === "deleteTree" ? ua.value.id : -1));
  return _.filter(
    updateActions,
    ua =>
      !(
        (ua.name === "deleteNode" || ua.name === "deleteEdge") &&
        deletedTreeIds.includes(ua.value.treeId)
      ),
  );
}

export function compactUpdateActions(updateActions: Array<UpdateAction>): Array<UpdateAction> {
  return compactDeletedTrees(
    compactMovedNodesAndEdges(removeUnrelevantUpdateActions(updateActions)),
  );
}

function removeAllButLastUpdateTracingAction(updateActionsBatches: Array<SaveQueueEntry>) {
  // This part of the code removes all entries from the save queue that consist only of
  // one updateTracing update action, except for the last one
  const updateTracingOnlyBatches = updateActionsBatches.filter(
    batch => batch.actions.length === 1 && batch.actions[0].name === "updateTracing",
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

export function compactSaveQueue(
  updateActionsBatches: Array<SaveQueueEntry>,
): Array<SaveQueueEntry> {
  // Remove empty batches
  const result = updateActionsBatches.filter(
    updateActionsBatch => updateActionsBatch.actions.length > 0,
  );

  return removeSubsequentUpdateTreeActions(removeAllButLastUpdateTracingAction(result));
}

export function performDiffTracing(
  tracingType: "skeleton" | "volume",
  prevTracing: Tracing,
  tracing: Tracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Array<UpdateAction> {
  let actions = [];
  if (tracingType === "skeleton" && tracing.skeleton != null && prevTracing.skeleton != null) {
    actions = actions.concat(
      Array.from(diffSkeletonTracing(prevTracing.skeleton, tracing.skeleton, prevFlycam, flycam)),
    );
  }

  if (tracingType === "volume" && tracing.volume != null && prevTracing.volume != null) {
    actions = actions.concat(
      Array.from(diffVolumeTracing(prevTracing.volume, tracing.volume, prevFlycam, flycam)),
    );
  }

  return actions;
}

export function* saveTracingAsync(): Saga<void> {
  yield _all([_call(saveTracingTypeAsync, "skeleton"), _call(saveTracingTypeAsync, "volume")]);
}

export function* saveTracingTypeAsync(tracingType: "skeleton" | "volume"): Saga<void> {
  yield* take(
    tracingType === "skeleton" ? "INITIALIZE_SKELETONTRACING" : "INITIALIZE_VOLUMETRACING",
  );

  let prevTracing = yield* select(state => state.tracing);
  let prevFlycam = yield* select(state => state.flycam);
  if (tracingType === "skeleton") {
    if (yield* select(state => enforceSkeletonTracing(state.tracing).activeTreeId == null)) {
      yield* put(createTreeAction());
    }
  }
  yield* take("WK_READY");
  const initialAllowUpdate = yield* select(
    state => state.tracing[tracingType] && state.tracing.restrictions.allowUpdate,
  );
  if (!initialAllowUpdate) return;

  while (true) {
    if (tracingType === "skeleton") {
      yield* take([...SkeletonTracingSaveRelevantActions, ...FlycamActions, "UNDO", "REDO"]);
    } else {
      yield* take([...VolumeTracingSaveRelevantActions, ...FlycamActions]);
    }
    // The allowUpdate setting could have changed in the meantime
    const allowUpdate = yield* select(
      state => state.tracing[tracingType] && state.tracing.restrictions.allowUpdate,
    );
    if (!allowUpdate) return;

    const tracing = yield* select(state => state.tracing);
    const flycam = yield* select(state => state.flycam);
    const items = compactUpdateActions(
      // $FlowFixMe: Should be resolved when we improve the typing of sagas in general
      Array.from(
        yield* call(performDiffTracing, tracingType, prevTracing, tracing, prevFlycam, flycam),
      ),
    );
    if (items.length > 0) {
      const updateActionChunks = _.chunk(items, maximumActionCountPerBatch);

      for (const updateActionChunk of updateActionChunks) {
        yield* put(pushSaveQueueAction(updateActionChunk, tracingType));
      }
    }
    prevTracing = tracing;
    prevFlycam = flycam;
  }
}
