/**
 * save_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from "ava";
import mockRequire from "mock-require";

mockRequire.stopAll();

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);

const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SaveReducer = mockRequire.reRequire("oxalis/model/reducers/save_reducer").default;
const { createEdge } = mockRequire.reRequire("oxalis/model/sagas/update_actions");

const initialState = {
  save: {
    isBusy: false,
    queue: [],
    lastSaveTimestamp: 0,
  },
};

test("Save should add update actions to the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue, [items]);
});

test("Save should add more update actions to the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(1, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const testState = SaveReducer(initialState, pushAction);
  const newState = SaveReducer(testState, pushAction);

  t.deepEqual(newState.save.queue, [items, items]);
});

test("Save should add zero update actions to the queue", t => {
  const items = [];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue, []);
});

test("Save should remove one update actions from the queue", t => {
  const firstItem = [createEdge(0, 1, 2)];
  const secondItem = [createEdge(1, 2, 3)];
  const firstPushAction = SaveActions.pushSaveQueueAction(firstItem);
  const secondPushAction = SaveActions.pushSaveQueueAction(secondItem);
  const popAction = SaveActions.shiftSaveQueueAction(1);
  let newState = SaveReducer(initialState, firstPushAction);
  newState = SaveReducer(newState, secondPushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, [secondItem]);
});

test("Save should remove zero update actions from the queue", t => {
  const items = [createEdge(0, 1, 2), createEdge(1, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const popAction = SaveActions.shiftSaveQueueAction(0);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, [items]);
});

test("Save should remove all update actions from the queue (1/2)", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const popAction = SaveActions.shiftSaveQueueAction(2);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, []);
});

test("Save should remove all update actions from the queue (2/2)", t => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueAction(items);
  const popAction = SaveActions.shiftSaveQueueAction(5);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, []);
});
