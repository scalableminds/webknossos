import mockRequire from "mock-require";
import test from "ava";
import "test/reducers/save_reducer.mock";
import dummyUser from "test/fixtures/dummy_user";
import type { OxalisState } from "oxalis/store";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import type { UpdateActionWithoutIsolationRequirement } from "oxalis/model/sagas/update_actions";

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
const AccessorMock = {
  getStats: () => null,
};
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/accessors/annotation_accessor", AccessorMock);

const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions") as typeof import(
  "oxalis/model/actions/save_actions",
);
const SaveReducer = mockRequire.reRequire("oxalis/model/reducers/save_reducer")
  .default as typeof import("oxalis/model/reducers/save_reducer")["default"];
const { createEdge } = mockRequire.reRequire("oxalis/model/sagas/update_actions") as typeof import(
  "oxalis/model/sagas/update_actions",
);

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
} as any as OxalisState;
test("Save should add update actions to the queue", (t) => {
  const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items);
  const newState = SaveReducer(initialState, pushAction);
  t.deepEqual(newState.save.queue, saveQueue);
});
test("Save should add more update actions to the queue", (t) => {
  const getItems = (treeId: number) => [
    createEdge(treeId, 1, 2, tracingId),
    createEdge(treeId, 2, 3, tracingId),
  ];
  const saveQueue = createSaveQueueFromUpdateActions([getItems(0), getItems(1)], TIMESTAMP);
  const testState = SaveReducer(initialState, SaveActions.pushSaveQueueTransaction(getItems(0)));
  const newState = SaveReducer(testState, SaveActions.pushSaveQueueTransaction(getItems(1)));
  t.deepEqual(newState.save.queue, saveQueue);
});
test("Save should add zero update actions to the queue", (t) => {
  const items: UpdateActionWithoutIsolationRequirement[] = [];
  const pushAction = SaveActions.pushSaveQueueTransaction(items);
  const newState = SaveReducer(initialState, pushAction);
  t.deepEqual(newState.save.queue, []);
});
test("Save should remove one update actions from the queue", (t) => {
  const firstItem = [createEdge(0, 1, 2, tracingId)];
  const secondItem = [createEdge(1, 2, 3, tracingId)];
  const saveQueue = createSaveQueueFromUpdateActions([secondItem], TIMESTAMP);
  const firstPushAction = SaveActions.pushSaveQueueTransaction(firstItem);
  const secondPushAction = SaveActions.pushSaveQueueTransaction(secondItem);
  const popAction = SaveActions.shiftSaveQueueAction(1);
  let newState = SaveReducer(initialState, firstPushAction);
  newState = SaveReducer(newState, secondPushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue, saveQueue);
});
test("Save should remove zero update actions from the queue", (t) => {
  const items = [createEdge(0, 1, 2, tracingId), createEdge(1, 2, 3, tracingId)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items);
  const popAction = SaveActions.shiftSaveQueueAction(0);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue, saveQueue);
});
test("Save should remove all update actions from the queue (1/2)", (t) => {
  const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items);
  const popAction = SaveActions.shiftSaveQueueAction(2);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue, []);
});
test("Save should remove all update actions from the queue (2/2)", (t) => {
  const items = [createEdge(0, 1, 2, tracingId), createEdge(0, 2, 3, tracingId)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items);
  const popAction = SaveActions.shiftSaveQueueAction(5);
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue, []);
});
