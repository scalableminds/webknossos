// @flow
import mockRequire from "mock-require";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import * as SaveActions from "oxalis/model/actions/save_actions";
import * as SkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import { take, call, put } from "redux-saga/effects";
import Request from "libs/request";

mockRequire.stopAll();
const { alert } = mockRequire.reRequire("libs/window");
const { compactUpdateActions, pushAnnotationAsync } = mockRequire.reRequire("oxalis/model/sagas/save_saga");


function expectValue(block) {
  expect(block.done).toBe(false);
  return expect(block.value);
}

describe("SaveSaga", () => {
  const initialState = {
    task: {
      id: 1,
    },
    skeletonTracing: {
      trees: {
        "0": {
          treeId: 0,
          name: "TestTree",
          nodes: {},
          timestamp: 12345678,
          branchPoints: [],
          edges: [],
          comments: [],
          color: [23, 23, 23],
        },
      },
      tracingType: "Explorational",
      name: "",
      activeTreeId: 0,
      activeNodeId: null,
      restrictions: {
        branchPointsAllowed: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
      },
    },
  };

  it("should compact multiple updateTracing update actions", () => {
    const updateActions = [
      UpdateActions.updateTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ];

    expect(compactUpdateActions(updateActions)).toEqual([updateActions[1]]);
  });

  it("should send update actions", () => {
    const updateActions = [
      UpdateActions.createEdge(0, 0, 1),
      UpdateActions.createEdge(0, 1, 2),
    ];

    const saga = pushAnnotationAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    expectValue(saga.next()).toEqual(take("PUSH_SAVE_QUEUE"));
    saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    expectValue(saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }))
      .toEqual(call(Request.sendJSONReceiveJSON,
        "/annotations/Explorational/1234567890?version=3", {
          method: "PUT",
          data: updateActions,
        }));
  });

  it("should retry update actions", () => {
    const updateActions = [
      UpdateActions.createEdge(0, 0, 1),
      UpdateActions.createEdge(0, 1, 2),
    ];

    const saga = pushAnnotationAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    expectValue(saga.next()).toEqual(take("PUSH_SAVE_QUEUE"));
    saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    expectValue(saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }))
      .toEqual(call(Request.sendJSONReceiveJSON,
        "/annotations/Explorational/1234567890?version=3", {
          method: "PUT",
          data: updateActions,
        }));

    saga.throw("Timeout");
    saga.next();
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    expectValue(saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }))
      .toEqual(call(Request.sendJSONReceiveJSON,
        "/annotations/Explorational/1234567890?version=3", {
          method: "PUT",
          data: updateActions,
        }));
  });

  it("should escalate on permanent client error update actions", () => {
    const updateActions = [
      UpdateActions.createEdge(0, 0, 1),
      UpdateActions.createEdge(0, 1, 2),
    ];

    const saga = pushAnnotationAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    expectValue(saga.next()).toEqual(take("PUSH_SAVE_QUEUE"));
    saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    expectValue(saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }))
      .toEqual(call(Request.sendJSONReceiveJSON,
        "/annotations/Explorational/1234567890?version=3", {
          method: "PUT",
          data: updateActions,
        }));

    saga.throw({ status: 409 });
    const alertEffect = saga.next().value;
    expect(alertEffect.CALL.fn).toBe(alert);
    expect(saga.next().done).toBe(true);
  });

  it("should send update actions right away", () => {
    const updateActions = [
      UpdateActions.createEdge(0, 0, 1),
      UpdateActions.createEdge(0, 1, 2),
    ];

    const saga = pushAnnotationAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    expectValue(saga.next()).toEqual(take("PUSH_SAVE_QUEUE"));
    saga.next(SaveActions.pushSaveQueueAction(updateActions, false));
    saga.next(SaveActions.saveNowAction());
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    expectValue(saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }))
      .toEqual(call(Request.sendJSONReceiveJSON,
        "/annotations/Explorational/1234567890?version=3", {
          method: "PUT",
          data: updateActions,
        }));
  });

  it("should remove the correct update actions", () => {
    const updateActions = [
      UpdateActions.updateTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ];

    const saga = pushAnnotationAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    expectValue(saga.next()).toEqual(take("PUSH_SAVE_QUEUE"));
    saga.next(SaveActions.pushSaveQueueAction(updateActions, false));
    saga.next(SaveActions.saveNowAction());
    saga.next();
    saga.next(true);
    saga.next(updateActions);
    saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" });
    expect(saga.next().value).toEqual(put(SkeletonTracingActions.setVersionNumber(3)));
    expect(saga.next().value).toEqual(put(SaveActions.setLastSaveTimestampAction()));
    expect(saga.next().value).toEqual(put(SaveActions.shiftSaveQueueAction(2)));
  });
});
