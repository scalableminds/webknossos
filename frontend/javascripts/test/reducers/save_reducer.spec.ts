import { vi, describe, it, expect } from "vitest";
import dummyUser from "test/fixtures/dummy_user";
import type { WebknossosState } from "viewer/store";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";

import { pushSaveQueueTransaction, shiftSaveQueueAction } from "viewer/model/actions/save_actions";
import SaveReducer from "viewer/model/reducers/save_reducer";
import { createEdge } from "viewer/model/sagas/volume/update_actions";
import { TIMESTAMP } from "test/global_mocks";

vi.mock("viewer/model/accessors/annotation_accessor", () => ({
  getStats: () => null,
}));

const tracingId = "1234567890";
const initialState = {
  activeUser: dummyUser,
  save: {
    isBusy: false,
    queue: [],
    lastSaveTimestamp: 0,
    progressInfo: {
      processedActionCount: 0,
      totalActionCount: 0,
    },
  },
} as any as WebknossosState;

describe("Save Reducer", () => {
  it("should add update actions to the queue", () => {
    const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
    const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
    const pushAction = pushSaveQueueTransaction(items);
    const newState = SaveReducer(initialState, pushAction);

    expect(newState.save.queue).toEqual(saveQueue);
  });

  it("should add more update actions to the queue", () => {
    const getItems = (treeId: number) => [
      createEdge(treeId, 1, 2, tracingId),
      createEdge(treeId, 2, 3, tracingId),
    ];
    const saveQueue = createSaveQueueFromUpdateActions([getItems(0), getItems(1)], TIMESTAMP);
    const testState = SaveReducer(initialState, pushSaveQueueTransaction(getItems(0)));
    const newState = SaveReducer(testState, pushSaveQueueTransaction(getItems(1)));

    expect(newState.save.queue).toEqual(saveQueue);
  });

  it("should add zero update actions to the queue", () => {
    const items: UpdateActionWithoutIsolationRequirement[] = [];
    const pushAction = pushSaveQueueTransaction(items);
    const newState = SaveReducer(initialState, pushAction);
    expect(newState.save.queue).toEqual([]);
  });

  it("should remove one update actions from the queue", () => {
    const firstItem = [createEdge(0, 1, 2, tracingId)];
    const secondItem = [createEdge(1, 2, 3, tracingId)];
    const saveQueue = createSaveQueueFromUpdateActions([secondItem], TIMESTAMP);
    const firstPushAction = pushSaveQueueTransaction(firstItem);
    const secondPushAction = pushSaveQueueTransaction(secondItem);
    const popAction = shiftSaveQueueAction(1);

    let newState = SaveReducer(initialState, firstPushAction);
    newState = SaveReducer(newState, secondPushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual(saveQueue);
  });

  it("should remove zero update actions from the queue", () => {
    const items = [createEdge(0, 1, 2, tracingId), createEdge(1, 2, 3, tracingId)];
    const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
    const pushAction = pushSaveQueueTransaction(items);
    const popAction = shiftSaveQueueAction(0);

    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual(saveQueue);
  });

  it("should remove all update actions from the queue (1/2)", () => {
    const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
    const pushAction = pushSaveQueueTransaction(items);
    const popAction = shiftSaveQueueAction(2);

    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual([]);
  });

  it("should remove all update actions from the queue (2/2)", () => {
    const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
    const pushAction = pushSaveQueueTransaction(items);
    const popAction = shiftSaveQueueAction(5);

    let newState = SaveReducer(initialState, pushAction);
    newState = SaveReducer(newState, popAction);

    expect(newState.save.queue).toEqual([]);
  });
});
