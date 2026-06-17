import { sendSaveRequestWithToken } from "admin/rest_api";
import DiffableMap from "libs/diffable_map";
import { alert } from "libs/window";
import { call, put } from "redux-saga/effects";
import { TIMESTAMP } from "test/global_mocks";
import { UnitLong } from "viewer/constants";
import {
  pushSaveQueueTransaction,
  setLastSaveTimestampAction,
  setVersionNumberAction,
  shiftSaveQueueAction,
} from "viewer/model/actions/save_actions";
import compactSaveQueue from "viewer/model/helpers/compaction/compact_save_queue";
import {
  addVersionNumbers,
  sendSaveRequestToServer,
  synchronizeAnnotationWithBackend,
  toggleErrorHighlighting,
} from "viewer/model/sagas/saving/save_queue_draining_saga";
import { MutexFetchingStrategy } from "viewer/model/sagas/saving/save_mutex_saga";
import * as saveMutexModule from "viewer/model/sagas/saving/save_mutex_saga";
import {
  createEdge,
  updateActiveNode,
  updateActiveSegmentId,
  updateCameraAnnotation,
  updateSegmentPartialVolumeAction,
} from "viewer/model/sagas/volume/update_actions";
import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import type { SaveQueueEntry } from "viewer/store";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { expectValueDeepEqual } from "../helpers/saga_test_helpers";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import "test/helpers/apiHelpers"; // ensures Store is available
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_server_objects";

vi.mock("viewer/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

vi.mock("admin/rest_api", () => ({
  sendSaveRequestWithToken: vi.fn(),
}));

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

function createMinimalStore(queue: SaveQueueEntry[]) {
  const initial = {
    annotation: {
      version: 1,
      annotationId,
      tracingStore: { url: TRACINGSTORE_URL },
    },
    save: { queue },
  };
  function reducer(state: typeof initial = initial, action: any) {
    if (action.type === "SHIFT_SAVE_QUEUE")
      return { ...state, save: { queue: state.save.queue.slice(action.count) } };
    if (action.type === "SET_VERSION_NUMBER")
      return { ...state, annotation: { ...state.annotation, version: action.version } };
    return state;
  }
  const sagaMiddleware = createSagaMiddleware();
  const store = createStore(reducer, applyMiddleware(sagaMiddleware));
  return { store, sagaMiddleware };
}

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

  it.skip("should send update actions", () => {
    const updateActions = [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]];
    const saveQueue = createSaveQueueFromUpdateActions(updateActions, TIMESTAMP);
    const saga = pushSaveQueueAsync();
    expectValueDeepEqual(expect, saga.next(), call(ensureWkInitialized));
    saga.next(); // setLastSaveTimestampAction

    saga.next(); // select state

    expectValueDeepEqual(expect, saga.next([]), take("PUSH_SAVE_QUEUE_TRANSACTION"));
    saga.next(); // race

    saga.next({
      forcePush: saveNowAction(),
    }); // select gate check
    expectValueDeepEqual(
      expect,
      saga.next(true), // gate check: savingAllowed = true
      put(setSaveBusyAction(true)),
    );

    expectValueDeepEqual(
      expect,
      saga.next(), // getOrCreateOperationContext
      call(getOrCreateOperationContext, { id: "save", description: "Saving annotation" }, null),
    );

    const synchronizeAnnotationWithBackendCallEffect = saga.next(fakeCtx); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue, fakeCtx),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting collaborationMode = false (not Concurrent)
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
      put(snapshotAnnotationStateForNextRebaseAction()),
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

  it.skip("should dispatch doneSavingAction when mutex fetching strategy is ad hoc", () => {
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
    }); // select gate check
    saga.next(true); // gate check: savingAllowed = true → setSaveBusyAction

    expectValueDeepEqual(
      expect,
      saga.next(), // getOrCreateOperationContext
      call(getOrCreateOperationContext, { id: "save", description: "Saving annotation" }, null),
    );

    const synchronizeAnnotationWithBackendCallEffect = saga.next(fakeCtx); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue, fakeCtx),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting collaborationMode = false (not Concurrent)
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
      put(snapshotAnnotationStateForNextRebaseAction()),
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

  it.skip("should send update actions right away and try to reach a state where all updates are saved", () => {
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
    }); // select gate check
    saga.next(true); // gate check: savingAllowed = true → setSaveBusyAction

    expectValueDeepEqual(
      expect,
      saga.next(), // getOrCreateOperationContext
      call(getOrCreateOperationContext, { id: "save", description: "Saving annotation" }, null),
    );

    const synchronizeAnnotationWithBackendCallEffect = saga.next(fakeCtx); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = true;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue, fakeCtx),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting collaborationMode = false (not Concurrent)
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
      put(snapshotAnnotationStateForNextRebaseAction()),
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

  it.skip("should not try to reach state with all actions being saved when saving is triggered by a timeout", () => {
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
    }); // select gate check
    saga.next(true); // gate check: savingAllowed = true → setSaveBusyAction

    expectValueDeepEqual(
      expect,
      saga.next(), // getOrCreateOperationContext
      call(getOrCreateOperationContext, { id: "save", description: "Saving annotation" }, null),
    );

    const synchronizeAnnotationWithBackendCallEffect = saga.next(fakeCtx); // calling synchronizeAnnotationWithBackend
    const enforceEmptySaveQueue = false;
    expectValueDeepEqual(
      expect,
      synchronizeAnnotationWithBackendCallEffect,
      call(synchronizeAnnotationWithBackend, enforceEmptySaveQueue, fakeCtx),
    );
    const { fn: synchronizeAnnotationWithBackendSagaFn, args } =
      synchronizeAnnotationWithBackendCallEffect.value.payload;

    // Start synchronizeAnnotationWithBackend sub saga
    const synchronizeAnnotationWithBackendSaga = synchronizeAnnotationWithBackendSagaFn(...args);
    synchronizeAnnotationWithBackendSaga.next();
    synchronizeAnnotationWithBackendSaga.next(false); // selecting collaborationMode = false (not Concurrent)
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

describe("synchronizeAnnotationWithBackend (integration)", () => {
  beforeEach(() => {
    vi.mocked(sendSaveRequestWithToken).mockResolvedValue({} as any);
    vi.spyOn(saveMutexModule, "getCurrentMutexFetchingStrategy").mockImplementation(
      function* () {
        return MutexFetchingStrategy.Continuously;
      } as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("sends the full queue when enforceEmptySaveQueue=true", async () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const { sagaMiddleware } = createMinimalStore(saveQueue);
    const task = sagaMiddleware.run(synchronizeAnnotationWithBackend, true);
    const result = await task.toPromise();

    expect(sendSaveRequestWithToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ hadConflict: false });
  });

  it("returns { hadConflict: true } on 409 with AdHoc strategy", async () => {
    vi.spyOn(saveMutexModule, "getCurrentMutexFetchingStrategy").mockImplementation(
      function* () {
        return MutexFetchingStrategy.AdHoc;
      } as any,
    );
    vi.mocked(sendSaveRequestWithToken).mockRejectedValue({ status: 409 });

    const saveQueue = createSaveQueueFromUpdateActions(
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const { sagaMiddleware } = createMinimalStore(saveQueue);
    const task = sagaMiddleware.run(synchronizeAnnotationWithBackend, true);
    const result = await task.toPromise();

    expect(result).toEqual({ hadConflict: true });
  });

  it("sends only the initial queue size when enforceEmptySaveQueue=false", async () => {
    const saveQueue = createSaveQueueFromUpdateActions(
      [[createEdge(1, 0, 1, tracingId)], [createEdge(1, 1, 2, tracingId)]],
      TIMESTAMP,
    );
    const { store, sagaMiddleware } = createMinimalStore(saveQueue);

    vi.mocked(sendSaveRequestWithToken).mockImplementation((() => {
      // Add an extra item to the queue mid-save; it must not be sent in this iteration
      store.dispatch(pushSaveQueueTransaction([createEdge(1, 2, 3, tracingId)]));
      return Promise.resolve({} as any);
    }) as any);

    const task = sagaMiddleware.run(synchronizeAnnotationWithBackend, false);
    await task.toPromise();

    expect(sendSaveRequestWithToken).toHaveBeenCalledTimes(1);
  });
});
