/**
 * save_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import * as SaveActions from "oxalis/model/actions/save_actions";
import SaveReducer from "oxalis/model/reducers/save_reducer";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { createEdge } from "oxalis/model/sagas/update_actions";

describe("Save", () => {
  const initialState = {
    save: {
      isBusy: false,
      queue: [],
      lastSaveTimestamp: 0,
    },
  };

  it("should add update actions to the queue", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(0, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const newState = SaveReducer(initialState, pushAction);

    expect(newState.save.queue).toEqual(items);
  });

  it("should add more update actions to the queue", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(1, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const testState = SaveReducer(initialState, pushAction);
    const newState = SaveReducer(testState, pushAction);

    expect(newState.save.queue).toEqual(items.concat(items));
  });

  it("should add zero update actions to the queue", () => {
    const items = [];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const newState = SaveReducer(initialState, pushAction);

    expect(newState.save.queue).toEqual([]);
  });

  it("should remove one update actions from the queue", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(1, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(1));
    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual([createEdge(1, 2, 3)]);
  });

  it("should remove zero update actions from the queue", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(1, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(0));
    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual(items);
  });

  it("should remove all update actions from the queue (1/2)", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(0, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(2));
    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual([]);
  });

  it("should remove all update actions from the queue (2/2)", () => {
    const items = [
      createEdge(0, 1, 2),
      createEdge(0, 2, 3),
    ];
    const pushAction = addTimestamp(SaveActions.pushSaveQueueAction(items));
    const popAction = addTimestamp(SaveActions.shiftSaveQueueAction(5));
    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual([]);
  });
});
