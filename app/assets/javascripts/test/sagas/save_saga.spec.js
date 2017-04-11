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
const { take, call, put } = mockRequire.reRequire("redux-saga/effects");
const Request = mockRequire.reRequire("libs/request").default;

const { alert } = mockRequire.reRequire("libs/window");
const { compactUpdateActions, pushAnnotationAsync } = mockRequire.reRequire("oxalis/model/sagas/save_saga");

const initialState = {
  dataset: {
    scale: [5, 5, 5],
  },
  task: {
    id: 1,
  },
  tracing: {
    type: "skeleton",
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

const INIT_ACTIONS = ["INITIALIZE_SKELETONTRACING", "INITIALIZE_VOLUMETRACING"];

test("SaveSaga should compact multiple updateTracing update actions", (t) => {
  const updateActions = [
    UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
    UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
  ];

  t.deepEqual(compactUpdateActions(updateActions), [updateActions[1]]);
});

test("SaveSaga should send update actions", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  expectValueDeepEqual(
    t,
    saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" }),
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

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  expectValueDeepEqual(t,
    saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" }),
    call(Request.sendJSONReceiveJSON,
      "/annotations/Explorational/1234567890?version=3", {
        method: "PUT",
        data: updateActions,
      },
    ),
  );

  saga.throw("Timeout");
  saga.next();
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  expectValueDeepEqual(t,
    saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" }),
    call(Request.sendJSONReceiveJSON,
      "/annotations/Explorational/1234567890?version=3", {
        method: "PUT",
        data: updateActions,
      },
    ),
  );
});

test("SaveSaga should escalate on permanent client error update actions", (t) => {
  const updateActions = [
    UpdateActions.createEdge(0, 0, 1),
    UpdateActions.createEdge(0, 1, 2),
  ];

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  expectValueDeepEqual(t,
    saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" }),
    call(Request.sendJSONReceiveJSON,
      "/annotations/Explorational/1234567890?version=3", {
        method: "PUT",
        data: updateActions,
      },
    ),
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
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, false));
  saga.next(SaveActions.saveNowAction());
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  expectValueDeepEqual(t,
    saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" }),
    call(Request.sendJSONReceiveJSON,
      "/annotations/Explorational/1234567890?version=3", {
        method: "PUT",
        data: updateActions,
      },
    ),
  );
});

test("SaveSaga should remove the correct update actions", (t) => {
  const updateActions = [
    UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
    UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
  ];

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, false));
  saga.next(SaveActions.saveNowAction());
  saga.next();
  saga.next(true);
  saga.next(updateActions);
  saga.next({ version: 2, tracingType: "Explorational", tracingId: "1234567890" });
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(2)));
});
