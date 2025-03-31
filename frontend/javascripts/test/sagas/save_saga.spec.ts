import { describe, expect, vi, it } from "vitest";
import { alert } from "libs/window";
import { setSaveBusyAction } from "oxalis/model/actions/save_actions";
import DiffableMap from "libs/diffable_map";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import { ensureWkReady } from "oxalis/model/sagas/ready_sagas";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";
import { UnitLong } from "oxalis/constants";

import { put, take, call } from "redux-saga/effects";
import * as SaveActions from "oxalis/model/actions/save_actions";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import {
  pushSaveQueueAsync,
  sendSaveRequestToServer,
  toggleErrorHighlighting,
  addVersionNumbers,
  sendRequestWithToken,
} from "oxalis/model/sagas/save_saga";

const TIMESTAMP = 1494695001688;

vi.mock("libs/date", () => ({
  default: {
    now: () => TIMESTAMP,
  },
}));

vi.mock("oxalis/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

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

describe("Save Saga", () => {
  it("should compact multiple updateTracing update actions", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [UpdateActions.updateSkeletonTracing(initialState.tracing, [1, 2, 3], [], [0, 0, 1], 1)],
        [UpdateActions.updateSkeletonTracing(initialState.tracing, [2, 3, 4], [], [0, 0, 1], 2)],
      ],
      TIMESTAMP,
    );
    expect(compactSaveQueue(saveQueue)).toEqual([saveQueue[1]]);
  });

  it("should send update actions", () => {
    const updateActions = [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkReady));
    saga.next(); // setLastSaveTimestampAction

    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    expectValueDeepEqual(
      expect,
      saga.next({
        forcePush: SaveActions.saveNowAction(),
      }),
      put(setSaveBusyAction(true)),
    );

    saga.next(); // advance to next select state

    expectValueDeepEqual(expect, saga.next(saveQueue), call(sendSaveRequestToServer));
    saga.next(saveQueue.length); // select state

    expectValueDeepEqual(expect, saga.next([]), put(setSaveBusyAction(false)));

    // Test that loop repeats
    saga.next(); // select state
    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  });

  it("should send request to server", () => {
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

    expect(versionIncrement).toBe(2);
    expectValueDeepEqual(
      expect,
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

  it("should retry update actions", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [UpdateActions.createEdge(1, 0, 1, tracingId)],
        [UpdateActions.createEdge(1, 1, 2, tracingId)],
      ],
      TIMESTAMP,
    );
    const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
    expect(versionIncrement).toBe(2);
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
    expectValueDeepEqual(expect, saga.next(TRACINGSTORE_URL), requestWithTokenCall);
    saga.throw("Timeout");
    expectValueDeepEqual(expect, saga.next("Explorational"), call(toggleErrorHighlighting, true));
    // wait for airbrake
    saga.next();
    // wait for retry
    saga.next();
    // should retry
    expectValueDeepEqual(expect, saga.next(), requestWithTokenCall);
  });

  it("should escalate on permanent client error update actions", () => {
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

    expect(versionIncrement).toBe(2);
    expectValueDeepEqual(
      expect,
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
    expect(alertEffect.payload.fn).toBe(alert);

    saga.next(); // sleep

    expect(() => saga.next()).toThrow();
  });

  it("should send update actions right away and try to reach a state where all updates are saved", () => {
    const updateActions = [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkReady));

    saga.next();
    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    saga.next({
      forcePush: SaveActions.saveNowAction(),
    }); // put setSaveBusyAction

    saga.next(); // select state

    saga.next(saveQueue); // call sendSaveRequestToServer

    saga.next(1); // advance to select state

    expectValueDeepEqual(expect, saga.next([]), put(setSaveBusyAction(false)));
  });

  it("should not try to reach state with all actions being saved when saving is triggered by a timeout", () => {
    const updateActions = [
      [UpdateActions.createEdge(1, 0, 1, tracingId)],
      [UpdateActions.createEdge(1, 1, 2, tracingId)],
    ];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkReady));
    saga.next();
    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    saga.next({
      timeout: "a placeholder",
    }); // put setSaveBusyAction

    saga.next(saveQueue); // call sendSaveRequestToServer

    expectValueDeepEqual(expect, saga.next([]), put(setSaveBusyAction(false)));
  });

  it("should remove the correct update actions", () => {
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

    expectValueDeepEqual(expect, saga.next(), put(SaveActions.setVersionNumberAction(3)));
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.shiftSaveQueueAction(2)));
  });

  it("should set the correct version numbers", () => {
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

    expectValueDeepEqual(
      expect,
      saga.next(),
      put(SaveActions.setVersionNumberAction(LAST_VERSION + 3)),
    );
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
  });

  it("should set the correct version numbers if the save queue was compacted", () => {
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
    expectValueDeepEqual(
      expect,
      saga.next(),
      put(SaveActions.setVersionNumberAction(LAST_VERSION + 1)),
    );
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(SaveActions.shiftSaveQueueAction(3)));
  });

  it("addVersionNumbers should set the correct version numbers", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [UpdateActions.createEdge(1, 0, 1, tracingId)],
        [UpdateActions.createEdge(1, 1, 2, tracingId)],
        [UpdateActions.createEdge(2, 3, 4, tracingId)],
      ],

      TIMESTAMP,
    );
    const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
    expect(versionIncrement).toBe(3);
    expect(saveQueueWithVersions[0].version).toBe(LAST_VERSION + 1);
    expect(saveQueueWithVersions[1].version).toBe(LAST_VERSION + 2);
    expect(saveQueueWithVersions[2].version).toBe(LAST_VERSION + 3);
  });
});
