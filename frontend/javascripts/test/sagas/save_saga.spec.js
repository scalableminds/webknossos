// @flow

import { alert } from "libs/window";
import { setSaveBusyAction } from "oxalis/model/actions/save_actions";
import DiffableMap from "libs/diffable_map";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import mockRequire from "mock-require";
import test from "ava";

import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";

mockRequire.stopAll();

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);

mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
mockRequire("@tensorflow/tfjs", {});
mockRequire("oxalis/workers/tensorflow.impl", {});
mockRequire("oxalis/workers/tensorflow.worker", {});

const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");
const SaveActions = mockRequire.reRequire("oxalis/model/actions/save_actions");
const { take, call, put } = mockRequire.reRequire("redux-saga/effects");

const {
  pushTracingTypeAsync,
  sendRequestToServer,
  toggleErrorHighlighting,
  addVersionNumbers,
  sendRequestWithToken,
} = mockRequire.reRequire("oxalis/model/sagas/save_saga");

const initialState = {
  dataset: {
    dataSource: {
      scale: [5, 5, 5],
    },
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
        nodes: new DiffableMap(),
        timestamp: 12345678,
        branchPoints: [],
        edges: [],
        comments: [],
        color: [23, 23, 23],
      },
    },
    annotationType: "Explorational",
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
const TRACINGSTORE_URL = "test.webknossos.xyz";
const TRACING_TYPE = "skeleton";

test("SaveSaga should compact multiple updateTracing update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ],
    TIMESTAMP,
  );

  t.deepEqual(compactSaveQueue(saveQueue), [saveQueue[1]]);
});

test("SaveSaga should send update actions", t => {
  const updateActions = [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);

  const saga = pushTracingTypeAsync(TRACING_TYPE);
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS[0]));
  saga.next(); // setLastSaveTimestampAction
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  saga.next(); // race
  saga.next(SaveActions.pushSaveQueueTransaction(updateActions));
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next(saveQueue), call(sendRequestToServer, TRACING_TYPE));
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), put(setSaveBusyAction(false, TRACING_TYPE)));

  // Test that loop repeats
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
});

test("SaveSaga should send request to server", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  expectValueDeepEqual(
    t,
    saga.next(TRACINGSTORE_URL),
    call(sendRequestWithToken, `${TRACINGSTORE_URL}/tracings/skeleton/1234567890/update?token=`, {
      method: "POST",
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
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  const requestWithTokenCall = call(
    sendRequestWithToken,
    `${TRACINGSTORE_URL}/tracings/skeleton/1234567890/update?token=`,
    {
      method: "POST",
      data: saveQueueWithVersions,
      compress: true,
    },
  );

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  expectValueDeepEqual(t, saga.next(TRACINGSTORE_URL), requestWithTokenCall);
  saga.throw("Timeout");
  expectValueDeepEqual(t, saga.next("Explorational"), call(toggleErrorHighlighting, true));
  // wait for retry
  saga.next();
  // should retry
  expectValueDeepEqual(t, saga.next(), requestWithTokenCall);
});

test("SaveSaga should escalate on permanent client error update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  const saveQueueWithVersions = addVersionNumbers(saveQueue, LAST_VERSION);
  expectValueDeepEqual(
    t,
    saga.next(TRACINGSTORE_URL),
    call(sendRequestWithToken, `${TRACINGSTORE_URL}/tracings/skeleton/1234567890/update?token=`, {
      method: "POST",
      data: saveQueueWithVersions,
      compress: true,
    }),
  );

  saga.throw({ status: 409 });
  saga.next("Explorational");
  saga.next(); // error reporting
  const alertEffect = saga.next().value;
  t.is(alertEffect.payload.fn, alert);
  t.true(saga.next().done);
});

test("SaveSaga should send update actions right away", t => {
  const updateActions = [UpdateActions.createEdge(1, 0, 1), UpdateActions.createEdge(1, 1, 2)];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);

  const saga = pushTracingTypeAsync(TRACING_TYPE);
  expectValueDeepEqual(t, saga.next(), take(INIT_ACTIONS[0]));
  saga.next();
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  saga.next(); // race
  saga.next(SaveActions.saveNowAction()); // put setSaveBusyAction
  saga.next(); // select state
  saga.next(saveQueue); // call sendRequestToServer
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), put(setSaveBusyAction(false, TRACING_TYPE)));
});

test("SaveSaga should remove the correct update actions", t => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      UpdateActions.updateSkeletonTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateSkeletonTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ],
    TIMESTAMP,
  );

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  saga.next(TRACINGSTORE_URL);
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(3, TRACING_TYPE)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction(TRACING_TYPE)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(2, TRACING_TYPE)));
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

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  saga.next(TRACINGSTORE_URL);
  expectValueDeepEqual(
    t,
    saga.next(),
    put(SaveActions.setVersionNumberAction(LAST_VERSION + 3, TRACING_TYPE)),
  );
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction(TRACING_TYPE)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3, TRACING_TYPE)));
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

  const saga = sendRequestToServer(TRACING_TYPE);
  saga.next();
  saga.next(saveQueue);
  saga.next({ version: LAST_VERSION, type: TRACING_TYPE, tracingId: "1234567890" });
  saga.next(TRACINGSTORE_URL);
  // two of the updateTracing update actions are removed by compactSaveQueue
  expectValueDeepEqual(
    t,
    saga.next(),
    put(SaveActions.setVersionNumberAction(LAST_VERSION + 1, TRACING_TYPE)),
  );
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction(TRACING_TYPE)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3, TRACING_TYPE)));
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
