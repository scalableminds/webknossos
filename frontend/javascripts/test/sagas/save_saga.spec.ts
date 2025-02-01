import "test/mocks/lz4";
import { alert } from "libs/window";
import { setSaveBusyAction } from "oxalis/model/actions/save_actions";
import DiffableMap from "libs/diffable_map";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import { ensureWkReady } from "oxalis/model/sagas/ready_sagas";
import mockRequire from "mock-require";
import test from "ava";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";
import { UnitLong } from "oxalis/constants";

const TIMESTAMP = 1494695001688;
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});
const UpdateActions = mockRequire.reRequire(
  "oxalis/model/sagas/update_actions",
  // biome-ignore format: biome produces invalid syntax when formatting this
) as typeof import("oxalis/model/sagas/update_actions");
const SaveActions = mockRequire.reRequire(
  "oxalis/model/actions/save_actions",
  // biome-ignore format: biome produces invalid syntax when formatting this
) as typeof import("oxalis/model/actions/save_actions");
const { take, call, put } = mockRequire.reRequire(
  "redux-saga/effects",
  // biome-ignore format: biome produces invalid syntax when formatting this
) as typeof import("redux-saga/effects");
const {
  pushSaveQueueAsync,
  sendSaveRequestToServer,
  toggleErrorHighlighting,
  addVersionNumbers,
  sendRequestWithToken,
} = mockRequire.reRequire(
  "oxalis/model/sagas/save_saga",
  // biome-ignore format: biome produces invalid syntax when formatting this
) as typeof import("oxalis/model/sagas/save_saga");

const annotationId = "annotation-abcdefgh";
const tracingId = "tracing-1234567890";
const initialState = {
  dataset: {
    dataSource: {
      scale: { factor: [5, 5, 5], unit: UnitLong.nm },
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
    tracingId,
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
const LAST_VERSION = 2;
const TRACINGSTORE_URL = "test.webknossos.xyz";
test("SaveSaga should compact multiple updateTracing update actions", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [1, 2, 3], [], [0, 0, 1], 1)],
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [2, 3, 4], [], [0, 0, 1], 2)],
    ],
    TIMESTAMP,
  );
  t.deepEqual(compactSaveQueue(saveQueue), [saveQueue[1]]);
});
test("SaveSaga should send update actions", (t) => {
  const updateActions = [
    [UpdateActions.createEdge(1, 0, 1, tracingId)],
    [UpdateActions.createEdge(1, 1, 2, tracingId)],
  ];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
  const saga = pushSaveQueueAsync();
  expectValueDeepEqual(t, saga.next(), call(ensureWkReady));
  saga.next(); // setLastSaveTimestampAction

  saga.next(); // select state

  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  saga.next(); // race

  expectValueDeepEqual(
    t,
    saga.next({
      forcePush: SaveActions.saveNowAction(),
    }),
    put(setSaveBusyAction(true)),
  );

  saga.next(); // advance to next select state

  expectValueDeepEqual(t, saga.next(saveQueue), call(sendSaveRequestToServer));
  saga.next(saveQueue.length); // select state

  expectValueDeepEqual(t, saga.next([]), put(setSaveBusyAction(false)));

  // Test that loop repeats
  saga.next(); // select state
  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
});

test("SaveSaga should send request to server", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ],
    TIMESTAMP,
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
  t.is(versionIncrement, 2);
  expectValueDeepEqual(
    t,
    saga.next(TRACINGSTORE_URL),
    call(
      sendRequestWithToken,
      `${TRACINGSTORE_URL}/tracings/annotation/${annotationId}/update?token=`,
      {
        method: "POST",
        data: saveQueueWithVersions,
        compress: false,
        showErrorToast: false,
      },
    ),
  );
});
test("SaveSaga should retry update actions", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ],
    TIMESTAMP,
  );
  const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
  t.is(versionIncrement, 2);
  const requestWithTokenCall = call(
    sendRequestWithToken,
    `${TRACINGSTORE_URL}/tracings/annotation/${annotationId}/update?token=`,
    {
      method: "POST",
      data: saveQueueWithVersions,
      compress: false,
      showErrorToast: false,
    },
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  expectValueDeepEqual(t, saga.next(TRACINGSTORE_URL), requestWithTokenCall);
  saga.throw("Timeout");
  expectValueDeepEqual(t, saga.next("Explorational"), call(toggleErrorHighlighting, true));
  // wait for airbrake
  saga.next();
  // wait for retry
  saga.next();
  // should retry
  expectValueDeepEqual(t, saga.next(), requestWithTokenCall);
});
test("SaveSaga should escalate on permanent client error update actions", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ],
    TIMESTAMP,
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
  t.is(versionIncrement, 2);
  expectValueDeepEqual(
    t,
    saga.next(TRACINGSTORE_URL),
    call(
      sendRequestWithToken,
      `${TRACINGSTORE_URL}/tracings/annotation/${annotationId}/update?token=`,
      {
        method: "POST",
        data: saveQueueWithVersions,
        compress: false,
        showErrorToast: false,
      },
    ),
  );
  saga.throw({
    status: 409,
  });
  saga.next("Explorational");
  saga.next(); // error reporting

  saga.next(); // airbrake

  const alertEffect = saga.next().value;
  t.is(alertEffect.payload.fn, alert);

  saga.next(); // sleep

  t.throws(() => saga.next());
});
test("SaveSaga should send update actions right away and try to reach a state where all updates are saved", (t) => {
  const updateActions = [
    [UpdateActions.createEdge(1, 0, 1, tracingId)],
    [UpdateActions.createEdge(1, 1, 2, tracingId)],
  ];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
  const saga = pushSaveQueueAsync();
  expectValueDeepEqual(t, saga.next(), call(ensureWkReady));
  saga.next();
  saga.next(); // select state

  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  saga.next(); // race

  saga.next({
    forcePush: SaveActions.saveNowAction(),
  }); // put setSaveBusyAction

  saga.next(); // select state

  saga.next(saveQueue); // call sendSaveRequestToServer

  saga.next(1); // advance to select state

  expectValueDeepEqual(t, saga.next([]), put(setSaveBusyAction(false)));
});
test("SaveSaga should not try to reach state with all actions being saved when saving is triggered by a timeout", (t) => {
  const updateActions = [
    [UpdateActions.createEdge(1, 0, 1, tracingId)],
    [UpdateActions.createEdge(1, 1, 2, tracingId)],
  ];
  const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
  const saga = pushSaveQueueAsync();
  expectValueDeepEqual(t, saga.next(), call(ensureWkReady));
  saga.next();
  saga.next(); // select state

  expectValueDeepEqual(t, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  saga.next(); // race

  saga.next({
    timeout: "a placeholder",
  }); // put setSaveBusyAction

  saga.next(saveQueue); // call sendSaveRequestToServer

  expectValueDeepEqual(t, saga.next([]), put(setSaveBusyAction(false)));
});
test("SaveSaga should remove the correct update actions", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [1, 2, 3], [], [0, 0, 1], 1)],
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [2, 3, 4], [], [0, 0, 1], 2)],
    ],
    TIMESTAMP,
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  saga.next(TRACINGSTORE_URL);
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(2)));
});
test("SaveSaga should set the correct version numbers", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
      [UpdateActions.createEdge(2, 3, 4, tracingId)],
    ],
    TIMESTAMP,
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  saga.next(TRACINGSTORE_URL);
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(LAST_VERSION + 3)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
});
test("SaveSaga should set the correct version numbers if the save queue was compacted", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [1, 2, 3], [], [0, 0, 1], 1)],
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [2, 3, 4], [], [0, 0, 1], 2)],
      [UpdateActions.updateSkeletonTracing(initialState.tracing, [3, 4, 5], [], [0, 0, 1], 3)],
    ],
    TIMESTAMP,
  );
  const saga = sendSaveRequestToServer();
  saga.next();
  saga.next(saveQueue);
  saga.next(LAST_VERSION);
  saga.next(annotationId);
  saga.next(TRACINGSTORE_URL);
  // two of the updateTracing update actions are removed by compactSaveQueue
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setVersionNumberAction(LAST_VERSION + 1)));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
  expectValueDeepEqual(t, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
});
test("SaveSaga addVersionNumbers should set the correct version numbers", (t) => {
  const saveQueue = createSaveQueueFromUpdateActions(
    [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
      [UpdateActions.createEdge(2, 3, 4, tracingId)],
    ],

    TIMESTAMP,
  );
  const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
  t.is(versionIncrement, 3);
  t.is(saveQueueWithVersions[0].version, LAST_VERSION + 1);
  t.is(saveQueueWithVersions[1].version, LAST_VERSION + 2);
  t.is(saveQueueWithVersions[2].version, LAST_VERSION + 3);
});
