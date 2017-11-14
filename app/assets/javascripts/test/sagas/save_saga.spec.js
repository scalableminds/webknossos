// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from "ava";
import mockRequire from "mock-require";
import _ from "lodash";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";

mockRequire.stopAll();

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);
mockRequire("libs/window", { alert: console.log.bind(console), location: { reload: _.noop } });
mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});

const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");
const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const { take, call, put } = mockRequire.reRequire("redux-saga/effects");

const { alert } = mockRequire.reRequire("libs/window");
const {
  compactUpdateActions,
  pushAnnotationAsync,
  sendRequestToServer,
  toggleErrorHighlighting,
  addVersionNumbers,
  sendRequestWithToken,
} = mockRequire.reRequire("oxalis/model/sagas/save_saga");

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
      "1": {
        treeId: 1,
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
    activeTreeId: 1,
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
const LAST_VERSION = 2;
const DATASTORE_URL = "test.webknossos.xyz";

test("SaveSaga should compact multiple updateTracing update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ],
    TIMESTAMP,
  );

  t.deepEqual(compactUpdateActions(saveQueue), [saveQueue[1]]);
});

test("SaveSaga should send update actions", t => {
  const updateActions = [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next(); // setLastSaveTimestampAction
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next();
  expectValueDeepEqual(t, saga.next(saveQueue), call(sendRequestToServer));
  saga.next(); // SET_SAVE_BUSY

  // Test that loop repeats
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
});

test("SaveSaga should send request to server", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TIMESTAMP);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  expectValueDeepEqual(
    t,
    saga.next(DATASTORE_URL),
    call(sendRequestWithToken, `${DATASTORE_URL}/data/tracings/skeleton/1234567890/update?token=`, {
      method: "POST",
      headers: { "X-Date": `${TIMESTAMP}` },
      data: saveQueueWithVersions,
      compress: true,
    }),
  );
});

test("SaveSaga should retry update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TIMESTAMP);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  expectValueDeepEqual(
    t,
    saga.next(DATASTORE_URL),
    call(sendRequestWithToken, `${DATASTORE_URL}/data/tracings/skeleton/1234567890/update?token=`, {
      method: "POST",
      headers: { "X-Date": `${TIMESTAMP}` },
      data: saveQueueWithVersions,
      compress: true,
    }),
  );

  expectValueDeepEqual(t, saga.throw("Timeout"), call(toggleErrorHighlighting, true));
  // wait for retry
  saga.next();
  // should retry
  expectValueDeepEqual(t, saga.next(), call(sendRequestToServer));
});

test("SaveSaga should escalate on permanent client error update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TIMESTAMP);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  expectValueDeepEqual(
    t,
    saga.next(DATASTORE_URL),
    call(sendRequestWithToken, `${DATASTORE_URL}/data/tracings/skeleton/1234567890/update?token=`, {
      method: "POST",
      headers: { "X-Date": `${TIMESTAMP}` },
      data: saveQueueWithVersions,
      compress: true,
    }),
  );

  saga.throw({ status: 409 });
  const alertEffect = saga.next().value;
  t.is(alertEffect.CALL.fn, alert);
  t.true(saga.next().done);
});

test("SaveSaga should send update actions right away", t => {
  const updateActions = [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);

  const saga = pushAnnotationAsync();
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS));
  saga.next();
  expectValueDeepEqual(t, saga.next(), take("PUSH_SAVE_QUEUE"));
  saga.next(SaveActions.pushSaveQueueAction(updateActions, true));
  saga.next(SaveActions.saveNowAction());
  saga.next(saveQueue);
  saga.next();
});

test("SaveSaga should remove the correct update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ],
    TIMESTAMP,
  );

  const saga = sendRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  saga.next(DATASTORE_URL);
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(2)));
});

test("SaveSaga should set the correct version numbers", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.createEdge(1, 0, 1),
      UpdateActions.createEdge(1, 1, 2),
      UpdateActions.createEdge(2, 3, 4),
    ],
    TIMESTAMP,
  );

  const saga = sendRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  saga.next(DATASTORE_URL);
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(LAST_VERSION + 3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
});

test("SaveSaga should set the correct version numbers if the save queue was compacted", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
      UpdateActions.updateSkeletonTracing(initialState, [3, 4, 5], [0, 0, 1], 3),
    ],
    TIMESTAMP,
  );

  const saga = sendRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: "skeleton", tracingId: "1234567890" });
  saga.next(DATASTORE_URL);
  // two of the updateTracing update actions are removed by compactUpdateActions
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(LAST_VERSION + 1)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
});

test("SaveSaga addVersionNumbers should set the correct version numbers", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.createEdge(1, 0, 1),
      UpdateActions.createEdge(1, 1, 2),
      UpdateActions.createEdge(2, 3, 4),
    ],
    TIMESTAMP,
  );
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  t.is(saveQueueWithVersions[0].version, LAST_VERSION + 1);
  t.is(saveQueueWithVersions[1].version, LAST_VERSION + 2);
  t.is(saveQueueWithVersions[2].version, LAST_VERSION + 3);
});
