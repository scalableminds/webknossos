// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from "ava";
import mockRequire from "mock-require";
import _ from "lodash";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";

mockRequire.stopAll();

mockRequire("libs/window", { alert: console.log.bind(console) });
mockRequire("app", { router: { off: _.noop, reload: _.noop } });

const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");
const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SkeletonTracingActions = mockRequire.reRequire("oxalis/model/actions/skeletontracing_actions");
const { take, call, put } = mockRequire.reRequire("redux-saga/effects");
const Request = mockRequire.reRequire("libs/request").default;

const { alert } = mockRequire.reRequire("libs/window");
const { compactUpdateActions, pushAnnotationAsync, sendRequestToServer, toggleErrorHighlighting } = mockRequire.reRequire("oxalis/model/sagas/save_saga");

const initialState = {
  dataset: {
    scale: [5, 5, 5],
  },
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

test("SaveSaga should compact multiple updateTracing update actions", (t) => {
  const updateActions = [
    UpdateActions.updateTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
    UpdateActions.updateTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
  ];

  t.deepEqual(compactUpdateActions(updateActions), [updateActions[1]]);
});

test("SaveSaga should send update actions", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_SKELETONTRACING"));
  saga.next(); // setLastSaveTimestampAction
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next();
  expectValueDeepEqual(t, saga.next(updateActions), call(sendRequestToServer));
  saga.next(); // SET_SAVE_BUSY

  // Test that loop repeats
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
});

test("SaveSaga should send request to server", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = sendRequestToServer();
  saga.next();
  saga.next(updateActions);
  expectValueDeepEqual(
    t,
    saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }),
    call(Request.sendJSONReceiveJSON, "/annotations/Explorational/1234567890?version=3", {
      method: "PUT",
      data: updateActions,
    }),
  );
});

test("SaveSaga should retry update actions", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = sendRequestToServer();
  saga.next();
  saga.next(updateActions);
  expectValueDeepEqual(
    t,
    saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }),
    call(Request.sendJSONReceiveJSON, "/annotations/Explorational/1234567890?version=3", {
      method: "PUT",
      data: updateActions,
    }),
  );

  expectValueDeepEqual(t, saga.throw("Timeout"), call(toggleErrorHighlighting, true));
  // wait for retry
  saga.next();
  // should retry
  expectValueDeepEqual(t, saga.next(), call(sendRequestToServer));
});

test("SaveSaga should escalate on permanent client error update actions", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = sendRequestToServer();
  saga.next();
  saga.next(updateActions);
  expectValueDeepEqual(
    t,
    saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" }),
    call(Request.sendJSONReceiveJSON, "/annotations/Explorational/1234567890?version=3", {
      method: "PUT",
      data: updateActions,
    }),
  );

  saga.throw({ status: 409 });
  const alertEffect = saga.next().value;
  t.is(alertEffect.CALL.fn, alert);
  t.true(saga.next().done);
});

test("SaveSaga should send update actions right away", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];
  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_SKELETONTRACING"));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next(SaveActions.saveNowAction());
  saga.next(updateActions);
  saga.next();
});

test("SaveSaga should remove the correct update actions", (t) => {
  const updateActions = [
    UpdateActions.updateTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
    UpdateActions.updateTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
  ];

  const saga = sendRequestToServer();
  saga.next();
  saga.next(updateActions);
  saga.next({ version: 2, tracingType: "Explorational", id: "1234567890" });
  expectValueDeepEqual(t, saga.next(), put(SkeletonTracingActions.setVersionNumber(3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(2)));
});
