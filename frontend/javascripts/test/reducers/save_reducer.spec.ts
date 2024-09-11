import mockRequire from "mock-require";
import test from "ava";
import "test/reducers/save_reducer.mock";
import dummyUser from "test/fixtures/dummy_user";
import type { SaveState } from "oxalis/store";
import type { APIUser } from "types/api_flow_types";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import type { EmptyObject } from "types/globals";
const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
const AccessorMock = {
  getStats: () => null,
};
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/accessors/skeletontracing_accessor", AccessorMock);
const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SaveReducer = mockRequire.reRequire("oxalis/model/reducers/save_reducer").default;
const { createEdge } = mockRequire.reRequire("oxalis/model/sagas/update_actions");

const initialState: { save: SaveState; activeUser: APIUser; tracing: EmptyObject } = {
  activeUser: dummyUser,
  save: {
    isBusyInfo: {
      skeleton: false,
      volumes: {},
      mappings: {},
    },
    queue: {
      skeleton: [],
      volumes: {},
      mappings: {},
    },
    lastSaveTimestamp: {
      skeleton: 0,
      volumes: {},
      mappings: {},
    },
    progressInfo: {
      processedActionCount: 0,
      totalActionCount: 0,
    },
  },
  tracing: {},
};
test("Save should add update actions to the queue", (t) => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const newState = SaveReducer(initialState, pushAction);
  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});
test("Save should add more update actions to the queue", (t) => {
  const getItems = (treeId: number) => [createEdge(treeId, 1, 2), createEdge(treeId, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([getItems(0), getItems(1)], TIMESTAMP);
  const testState = SaveReducer(
    initialState,
    SaveActions.pushSaveQueueTransaction(getItems(0), "skeleton"),
  );
  const newState = SaveReducer(
    testState,
    SaveActions.pushSaveQueueTransaction(getItems(1), "skeleton"),
  );
  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});
test("Save should add zero update actions to the queue", (t) => {
  // @ts-expect-error ts-migrate(7034) FIXME: Variable 'items' implicitly has type 'any[]' in so... Remove this comment to see the full error message
  const items = [];
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'items' implicitly has an 'any[]' type.
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const newState = SaveReducer(initialState, pushAction);
  t.deepEqual(newState.save.queue.skeleton, []);
});
test("Save should remove one update actions from the queue", (t) => {
  const firstItem = [createEdge(0, 1, 2)];
  const secondItem = [createEdge(1, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([secondItem], TIMESTAMP);
  const firstPushAction = SaveActions.pushSaveQueueTransaction(firstItem, "skeleton");
  const secondPushAction = SaveActions.pushSaveQueueTransaction(secondItem, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(1, "skeleton");
  let newState = SaveReducer(initialState, firstPushAction);
  newState = SaveReducer(newState, secondPushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});
test("Save should remove zero update actions from the queue", (t) => {
  const items = [createEdge(0, 1, 2), createEdge(1, 2, 3)];
  const saveQueue = createSaveQueueFromUpdateActions([items], TIMESTAMP);
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(0, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue.skeleton, saveQueue);
});
test("Save should remove all update actions from the queue (1/2)", (t) => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(2, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue.skeleton, []);
});
test("Save should remove all update actions from the queue (2/2)", (t) => {
  const items = [createEdge(0, 1, 2), createEdge(0, 2, 3)];
  const pushAction = SaveActions.pushSaveQueueTransaction(items, "skeleton");
  const popAction = SaveActions.shiftSaveQueueAction(5, "skeleton");
  let newState = SaveReducer(initialState, pushAction);
  newState = SaveReducer(newState, popAction);
  t.deepEqual(newState.save.queue.skeleton, []);
});
