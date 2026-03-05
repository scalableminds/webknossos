import { sendSaveRequestWithToken } from "admin/rest_api";
import DiffableMap from "libs/diffable_map";
import { alert } from "libs/window";
import { call, put, take } from "redux-saga/effects";
import { TIMESTAMP } from "test/global_mocks";
import { UnitLong } from "viewer/constants";
import {
  doneSavingAction,
  saveNowAction,
  setLastSaveTimestampAction,
  setSaveBusyAction,
  setVersionNumberAction,
  shiftSaveQueueAction,
} from "viewer/model/actions/save_actions";
import compactSaveQueue from "viewer/model/helpers/compaction/compact_save_queue";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import {
  addVersionNumbers,
  pushSaveQueueAsync,
  sendSaveRequestToServer,
  synchronizeAnnotationWithBackend,
  toggleErrorHighlighting,
} from "viewer/model/sagas/saving/save_queue_draining_saga";
import {
  createEdge,
  updateActiveNode,
  updateActiveSegmentId,
  updateCameraAnnotation,
  updateSegmentPartialVolumeAction,
} from "viewer/model/sagas/volume/update_actions";
import { describe, expect, it, vi } from "vitest";
import { expectValueDeepEqual } from "../helpers/saga_test_helpers";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import "test/helpers/apiHelpers"; // ensures Store is available
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_server_objects";
import { MutexFetchingStrategy } from "viewer/model/sagas/saving/save_mutex_saga";

vi.mock("viewer/model/sagas/root_saga", () => {
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
  annotation: {
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
    isUpdatingCurrentlyAllowed: true,
  },
};
const LAST_VERSION = 2;
const TRACINGSTORE_URL = "test.webknossos.xyz";

describe("Save Saga", () => {
  it("should compact multiple updateTracing update actions", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [updateActiveNode(initialState.annotation)],
        [updateActiveSegmentId(3, initialState.annotation.tracingId)],
        [updateCameraAnnotation([1, 2, 3], null, [1, 2, 3], 1)],

        [updateActiveNode(initialState.annotation)],
        [updateActiveSegmentId(4, initialState.annotation.tracingId)],
        [updateCameraAnnotation([2, 2, 3], null, [1, 2, 3], 1)],
      ],
      TIMESTAMP,
    );
    expect(compactSaveQueue(saveQueue)).toEqual([saveQueue[3], saveQueue[4], saveQueue[5]]);
  });

  it("should compact multiple updateSegmentPartial update actions", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [
          updateSegmentPartialVolumeAction(
            {
              id: 3,
              color: [1, 2, 3],
            },
            VOLUME_TRACING_ID,
          ),
        ],
        [
          updateSegmentPartialVolumeAction(
            {
              id: 3,
              name: "3 some name",
            },
            VOLUME_TRACING_ID,
          ),
        ],
        [
          updateSegmentPartialVolumeAction(
            {
              id: 4,
              color: [1, 2, 4],
            },
            VOLUME_TRACING_ID,
          ),
        ],
        [
          updateSegmentPartialVolumeAction(
            {
              id: 4,
              name: "4 some name",
              anchorPosition: [1, 2, 3],
            },
            VOLUME_TRACING_ID,
          ),
        ],
        [
          updateSegmentPartialVolumeAction(
            {
              id: 3,
              name: "3 some name (changed)",
            },
            VOLUME_TRACING_ID,
          ),
        ],
      ],
      TIMESTAMP,
    );
    const compactedQueue = compactSaveQueue(saveQueue);
    expect(compactedQueue.length).toEqual(3);
    expect(compactedQueue[0].actions).toEqual([
      updateSegmentPartialVolumeAction(
        {
          id: 3,
          color: [1, 2, 3],
          name: "3 some name",
        },
        VOLUME_TRACING_ID,
      ),
    ]);
    expect(compactedQueue[1].actions).toEqual([
      updateSegmentPartialVolumeAction(
        {
          id: 4,
          name: "4 some name",
          color: [1, 2, 4],
          anchorPosition: [1, 2, 3],
        },
        VOLUME_TRACING_ID,
      ),
    ]);
    expect(compactedQueue[2].actions).toEqual([
      updateSegmentPartialVolumeAction(
        {
          id: 3,
          name: "3 some name (changed)",
        },
        VOLUME_TRACING_ID,
      ),
    ]);
  });

  it("should send update actions", () => {
    const updateActions = [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkInitialized));
    saga.next(); // setLastSaveTimestampAction

    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    expectValueDeepEqual(
      expect,
      saga.next({
        forcePush: saveNowAction(),
      }),
      put(setSaveBusyAction(true)),
    );

    const synchronizeAnnotationWithBackendCallEffect = saga.next(); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting othersMayEdit = false
    synchronizeAnnotationWithBackendSaga.next(MutexFetchingStrategy.Continuously); // select mutex fetching strategy
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(saveQueue),
      call(sendSaveRequestToServer, true),
    );
    synchronizeAnnotationWithBackendSaga.next({
      numberOfSentItems: saveQueue.length,
      hadConflict: false,
    });
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next([]), // select save queue
      put(doneSavingAction()),
    );
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(), // select save queue
      put(setSaveBusyAction(false)),
    );
    expect(synchronizeAnnotationWithBackendSaga.next().done).toBe(true);

    saga.next({ shouldRetryOnConflict: false }); // select state
    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  });

  it("should dispatch doneSavingAction when mutex fetching strategy is ad hoc", () => {
    const updateActions = [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkInitialized));
    saga.next(); // setLastSaveTimestampAction

    saga.next(); // select state

    saga.next([]);
    saga.next(); // race

    saga.next({
      forcePush: saveNowAction(),
    });

    const synchronizeAnnotationWithBackendCallEffect = saga.next(); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting othersMayEdit = false
    synchronizeAnnotationWithBackendSaga.next(MutexFetchingStrategy.AdHoc); // select mutex fetching strategy
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(saveQueue),
      call(sendSaveRequestToServer, false),
    );
    synchronizeAnnotationWithBackendSaga.next({
      numberOfSentItems: saveQueue.length,
      hadConflict: false,
    });
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next([]),
      put(doneSavingAction()),
    );
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(),
      put(setSaveBusyAction(false)),
    );
    expect(synchronizeAnnotationWithBackendSaga.next().done).toBe(true);

    saga.next({ shouldRetryOnConflict: false }); // select state
    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  });

  it("should send request to server", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const saga = sendSaveRequestToServer(true);

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
        sendSaveRequestWithToken,
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
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const [saveQueueWithVersions, versionIncrement] = addVersionNumbers(saveQueue, LAST_VERSION);
    expect(versionIncrement).toBe(2);
    const requestWithTokenCall = call(
      sendSaveRequestWithToken,
      `${TRACINGSTORE_URL}/tracings/annotation/${annotationId}/update?token=`,
      {
        method: "POST",
        data: saveQueueWithVersions,
        compress: false,
        showErrorToast: false,
      },
    );
    const saga = sendSaveRequestToServer(true);

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
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const saga = sendSaveRequestToServer(true);

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
        sendSaveRequestWithToken,
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

    expect(() => saga.next()).toThrow();
  });

  it("should send update actions right away and try to reach a state where all updates are saved", () => {
    const updateActions = [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkInitialized));

    saga.next();
    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    saga.next({
      forcePush: saveNowAction(),
    }); // put setSaveBusyAction

    const synchronizeAnnotationWithBackendCallEffect = saga.next(); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting othersMayEdit = false
    synchronizeAnnotationWithBackendSaga.next(MutexFetchingStrategy.Continuously); // select mutex fetching strategy
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(saveQueue),
      call(sendSaveRequestToServer, true),
    );
    synchronizeAnnotationWithBackendSaga.next({
      numberOfSentItems: saveQueue.length,
      hadConflict: false,
    });
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next([]), // select save queue
      put(doneSavingAction()),
    );
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(), // select save queue
      put(setSaveBusyAction(false)),
    );
    expect(synchronizeAnnotationWithBackendSaga.next().done).toBe(true);

    saga.next({ shouldRetryOnConflict: false }); // select state
    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
  });

  it("should not try to reach state with all actions being saved when saving is triggered by a timeout", () => {
    const updateActions = [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkInitialized));
    saga.next();
    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    saga.next({
      timeout: "a placeholder",
    }); // put setSaveBusyAction

    const synchronizeAnnotationWithBackendCallEffect = saga.next({ shouldRetryOnConflict: false }); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = false;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting othersMayEdit = false
    synchronizeAnnotationWithBackendSaga.next(MutexFetchingStrategy.Continuously); // select mutex fetching strategy
    synchronizeAnnotationWithBackendSaga.next(saveQueue.length); // select save queue length
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next(saveQueue),
      call(sendSaveRequestToServer, true),
    );

    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendSaga.next({
        numberOfSentItems: saveQueue.length,
        hadConflict: false,
      }),
      put(setSaveBusyAction(false)),
    );
    expect(synchronizeAnnotationWithBackendSaga.next().done).toBe(true);

    saga.next([]);
  });

  it("should remove the correct update actions", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [[updateActiveNode(initialState.annotation)], [updateActiveNode(initialState.annotation)]],
      TIMESTAMP,
    );
    const saga = sendSaveRequestToServer(true);

    saga.next();
    saga.next(saveQueue);
    saga.next(LAST_VERSION);
    saga.next(annotationId);
    saga.next(TRACINGSTORE_URL);

    expectValueDeepEqual(expect, saga.next(), put(setVersionNumberAction(3)));
    expectValueDeepEqual(expect, saga.next(), put(setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(shiftSaveQueueAction(2)));
  });

  it("should set the correct version numbers", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [createEdge(1, 0, 1, tracingId)],
        [createEdge(1, 1, 2, tracingId)],
        [createEdge(2, 3, 4, tracingId)],
      ],
      TIMESTAMP,
    );
    const saga = sendSaveRequestToServer(true);

    saga.next();
    saga.next(saveQueue);
    saga.next(LAST_VERSION);
    saga.next(annotationId);
    saga.next(TRACINGSTORE_URL);

    expectValueDeepEqual(expect, saga.next(), put(setVersionNumberAction(LAST_VERSION + 3)));
    expectValueDeepEqual(expect, saga.next(), put(setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(shiftSaveQueueAction(3)));
  });

  it("should set the correct version numbers if the save queue was compacted", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [updateActiveNode(initialState.annotation)],
        [updateActiveNode(initialState.annotation)],
        [updateActiveNode(initialState.annotation)],
      ],
      TIMESTAMP,
    );
    const saga = sendSaveRequestToServer(true);

    saga.next();
    saga.next(saveQueue);
    saga.next(LAST_VERSION);
    saga.next(annotationId);
    saga.next(TRACINGSTORE_URL);

    // two of the updateTracing update actions are removed by compactSaveQueue
    expectValueDeepEqual(expect, saga.next(), put(setVersionNumberAction(LAST_VERSION + 1)));
    expectValueDeepEqual(expect, saga.next(), put(setLastSaveTimestampAction()));
    expectValueDeepEqual(expect, saga.next(), put(shiftSaveQueueAction(3)));
  });

  it("addVersionNumbers should set the correct version numbers", () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [
        [createEdge(1, 0, 1, tracingId)],
        [createEdge(1, 1, 2, tracingId)],
        [createEdge(2, 3, 4, tracingId)],
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
