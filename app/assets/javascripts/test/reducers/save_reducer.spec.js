/**
 * save_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from 'ava';

import * as SaveActions from "oxalis/model/actions/save_actions";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { createEdge } from "oxalis/model/sagas/update_actions";

const initialState = {
  save: {
    isBusy: false,
    queue: [],
    lastSaveTimestamp: 0,
  },
};

test("Save should add update actions to the queue", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(0, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue, items);
});

test("Save should add more update actions to the queue", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(1, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const testState = SaveReducer(initialState, pushAction);
  const newState = SaveReducer(testState, pushAction);

  t.deepEqual(newState.save.queue, items.concat(items));
});

test("Save should add zero update actions to the queue", t => {
  const items = [];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const newState = SaveReducer(initialState, pushAction);

  t.deepEqual(newState.save.queue, []);
});

test("Save should remove one update actions from the queue", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(1, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(1));
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, [createEdge(1, 2, 3)]);
});

test("Save should remove zero update actions from the queue", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(1, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(0));
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, items);
});

test("Save should remove all update actions from the queue (1/2)", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(0, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(2));
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, []);
});

test("Save should remove all update actions from the queue (2/2)", t => {
  const items = [
    createEdge(0, 1, 2),
    createEdge(0, 2, 3),
  ];
  const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
  const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(5));
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);

  t.deepEqual(newState.save.queue, []);
});
