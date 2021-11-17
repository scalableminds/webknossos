// @flow
import Maybe from "data.maybe";
import mockRequire from "mock-require";
import test from "ava";

import "test/reducers/save_reducer.mock";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
const AccessorMock = {
  getStats: () => Maybe.Nothing(),
};
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/accessors/skeletontracing_accessor", AccessorMock);

const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SaveReducer = mockRequire.reRequire("oxalis/model/reducers/save_reducer").default;
const { createEdge } = mockRequire.reRequire("oxalis/model/sagas/update_actions");

const initialState = {
  save: {
    isBusy: false,
    queue: { skeleton: [], volumes: {} },
    lastSaveTimestamp: { skeleton: 0, volume: 0 },
    progressInfo: {
      processedActionCount: 0,
      totalActionCount: 0,
    },
  },
};

test("Save should add update actions to the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});

test("Save should add more update actions to the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(1, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([items, items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const testState = SaveReducer(initialState, pushAction);
  const newState = SaveReducer(testState, pushAction);

  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});

test("Save should add zero update actions to the queue", t => {
  const items = [];
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue.skeleton, []);
});

test("Save should remove one update actions from the queue", t => {
  const firstItem = [createEdge(0, 1, 2)];
  const secondItem = [createEdge(1, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions(secondItem, TIMESTAMP);
  const firstPushAction = SaveActions.pushSaveQueueTransaction(firstItem, "skeleton");
  const secondPushAction = SaveActions.pushSaveQueueTransaction(secondItem, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(1, "skeleton");
  let newState = SaveReducer(initialState, firstPushAction);
  newState = SaveReducer(newState, secondPushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});

test("Save should remove zero update actions from the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(1, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(0, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});

test("Save should remove all update actions from the queue (1/2)", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(2, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue.skeleton, []);
});

test("Save should remove all update actions from the queue (2/2)", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(5, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue.skeleton, []);
});
