import type { Saga } from "viewer/model/sagas/effect-generators";
import { call, put, select, take } from "redux-saga/effects";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { powerOrga } from "test/fixtures/dummy_organization";
import {
  type BucketOverride,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import {
  proofreadMergeAction,
  minCutAgglomerateWithPositionAction,
} from "viewer/model/actions/proofread_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { type SaveQueueEntry, startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryToIncorporateActions } from "viewer/model/sagas/saving/save_saga";
import { ColoredLogger, sleep } from "libs/utils";
import Constants, { type Vector2 } from "viewer/constants";
import type { APIUpdateActionBatch } from "types/api_types";
import type { RequestOptionsWithData } from "libs/request";
import type { ServerUpdateAction } from "viewer/model/sagas/volume/update_actions";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";

function* initializeMappingAndTool(context: WebknossosTestContext, tracingId: string): Saga<void> {
  const { api } = context;
  // Set up organization with power plan (necessary for proofreading)
  // and zoom in so that buckets in mag 1, 1, 1 are loaded.
  yield put(setActiveOrganizationAction(powerOrga));
  yield put(setZoomStepAction(0.3));
  const currentMag = yield select((state) => getCurrentMag(state, tracingId));
  expect(currentMag).toEqual([1, 1, 1]);

  // Activate agglomerate mapping and wait for finished mapping initialization
  // (unfortunately, that action is dispatched twice; once for the activation and once
  // for the changed BucketRetrievalSource). Ideally, this should be refactored away.
  yield put(setMappingAction(tracingId, sampleHdf5AgglomerateName, "HDF5"));
  yield take("FINISH_MAPPING_INITIALIZATION");

  yield take("FINISH_MAPPING_INITIALIZATION");

  // Activate the proofread tool. WK will reload the bucket data and apply the mapping
  // locally (acknowledged by FINISH_MAPPING_INITIALIZATION).
  yield put(setToolAction(AnnotationTool.PROOFREAD));
  yield take("FINISH_MAPPING_INITIALIZATION");

  // Read data from the 0,0,0 bucket so that it is in memory (important because the mapping
  // is only maintained for loaded buckets).
  const valueAt444 = yield call(() => api.data.getDataValue(tracingId, [4, 4, 4], 0));
  expect(valueAt444).toBe(4);
  // Once again, we wait for FINISH_MAPPING_INITIALIZATION because the mapping is updated
  // for the keys that are found in the newly loaded bucket.
  yield take("FINISH_MAPPING_INITIALIZATION");
}

const initialMapping = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
  // [1337, 1337],
]);

const expectedMappingAfterMerge = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 6],
  [7, 6],
  // [1337, 1337],
]);

const expectedMappingAfterMergeRebase = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 1],
  [7, 1],
  // [1337, 1337],
]);

const expectedMappingAfterSplit = new Map([
  [1, 9],
  [2, 10],
  [3, 10],
  [4, 11],
  [5, 11],
  [6, 12],
  [7, 12],
  // [1337, 1337],
]);

class BackendMock {
  typedArrayClass = Uint16Array;
  fillValue = 1;
  requestDelay = 5;
  updateActionLog: APIUpdateActionBatch[] = [];
  onSavedListeners: Array<() => void> = [];
  agglomerateMapping = new AgglomerateMapping(
    [
      // each tuple is an edge between two super voxels
      [1, 2], // {1, 2, 3}
      [2, 3],
      [4, 5], // {4, 5}
      [6, 7], // {6, 7}
      // [1337, 1337],
    ],
    1, // the annotation's current version (as defined in hybridtracing_server_objects.ts)
  );

  // todop: this is a reference to the same variable that is
  // set up in apiHelpers. when BackendMock is used in other tests,
  // too, it probably makes sense to remove it in favor of
  // `updateActionLog` which is mostly equivalent.
  receivedDataPerSaveRequest: Array<SaveQueueEntry[]> = [];

  constructor(public overrides: BucketOverride[]) {}

  addOnSavedListener = (fn: () => void) => {
    // Attached listeners are called after the mock received a
    // save-request. This can be used to inject other versions (simulating
    // other users).
    this.onSavedListeners.push(fn);
  };

  // todop: DRY with createBucketResponseFunction?
  sendJSONReceiveArraybufferWithHeaders = async (
    _url: string,
    payload: { data: Array<unknown> },
  ) => {
    // console.log("[BackendMock] sendJSONReceiveArraybufferWithHeaders");
    await sleep(this.requestDelay);
    const bucketCount = payload.data.length;
    const TypedArrayClass = this.typedArrayClass;
    const typedArray = new TypedArrayClass(bucketCount * 32 ** 3).fill(this.fillValue);

    for (let bucketIdx = 0; bucketIdx < bucketCount; bucketIdx++) {
      for (const { position, value } of this.overrides) {
        const [x, y, z] = position;
        const indexInBucket =
          bucketIdx * Constants.BUCKET_WIDTH ** 3 +
          z * Constants.BUCKET_WIDTH ** 2 +
          y * Constants.BUCKET_WIDTH +
          x;
        typedArray[indexInBucket] = value;
      }
    }

    return {
      buffer: new Uint8Array(typedArray.buffer).buffer,
      headers: {
        "missing-buckets": "[]",
      },
    };
  };

  getCurrentMappingEntriesFromServer = (version?: number | null | undefined): Vector2[] => {
    if (version == null) {
      throw new Error("Version is null?");
    }
    // This function should always return the full current mapping.
    // The values will be filtered according to the requested keys
    // in `getAgglomeratesForSegmentsImpl`.
    const mapping = this.agglomerateMapping.getMap(version).entries().toArray();

    console.log(`Replying with mapping for v=${version}: `, mapping);
    return mapping;
  };

  acquireAnnotationMutex = async (_annotationId: string) => {
    // console.log("[BackendMock] acquireAnnotationMutex");
    return { canEdit: true, blockedByUser: null };
  };

  saveQueueEntriesToUpdateActionBatch = (data: Array<SaveQueueEntry>) => {
    return data.map((entry) => ({
      version: entry.version,
      value: entry.actions.map(
        (action) =>
          ({
            ...action,
            value: {
              actionTimestamp: 0,
              ...action.value,
            },
          }) as ServerUpdateAction,
      ),
    }));
  };

  sendSaveRequestWithToken = async (
    _urlWithoutToken: string,
    payload: RequestOptionsWithData<Array<SaveQueueEntry>>,
  ): Promise<void> => {
    // Store the received request.
    this.receivedDataPerSaveRequest.push(payload.data);

    // Convert the request to APIUpdateActionBatch
    // so that it can be stored within updateActionLog.
    // Theoretically, multiple requests could form a transaction which
    // would require merging the update actions. However, this does not happen
    // in the tests yet.
    const newItems = this.saveQueueEntriesToUpdateActionBatch(payload.data);
    this.updateActionLog.push(...newItems);

    // Process received update actions and update agglomerateMapping.
    for (const item of newItems) {
      console.log("pushing to server: v=", item.version, "with", item.value);
      let agglomerateActionCounter = 0;
      for (const updateAction of item.value) {
        if (updateAction.name === "mergeAgglomerate") {
          if (updateAction.value.segmentId1 == null || updateAction.value.segmentId2 == null) {
            throw new Error("Segment Id is null");
          }
          if (agglomerateActionCounter > 0) {
            throw new Error(
              "Not implemented yet. AgglomerateMapping needs to support multiple actions while incrementing the version only by one.",
            );
          }
          this.agglomerateMapping.addEdge(
            updateAction.value.segmentId1,
            updateAction.value.segmentId2,
          );
          agglomerateActionCounter++;
        } else if (updateAction.name === "splitAgglomerate") {
          if (updateAction.value.segmentId1 == null || updateAction.value.segmentId2 == null) {
            throw new Error("Segment Id is null");
          }
          if (agglomerateActionCounter > 0) {
            throw new Error(
              "Not implemented yet. AgglomerateMapping needs to support multiple actions while incrementing the version only by one.",
            );
          }
          this.agglomerateMapping.removeEdge(
            updateAction.value.segmentId1,
            updateAction.value.segmentId2,
          );
          agglomerateActionCounter++;
        } else {
          // We need the agglomerate mapping to be in sync
          this.agglomerateMapping.bumpVersion();
        }
      }
    }
    for (const fn of this.onSavedListeners) {
      fn();
    }
  };

  getUpdateActionLog = async (
    _tracingStoreUrl: string,
    _annotationId: string,
    oldestVersion?: number,
    _newestVersion?: number,
    sortAscending: boolean = false,
  ): Promise<Array<APIUpdateActionBatch>> => {
    const firstUnseenVersionIndex = this.updateActionLog.findIndex(
      (item) => item.version === oldestVersion,
    );
    if (firstUnseenVersionIndex === -1) {
      return [];
    }
    if (!sortAscending) {
      throw new Error("Unexpected request");
    }
    return this.updateActionLog.slice(firstUnseenVersionIndex);
  };
}

function mockInitialBucketAndAgglomerateData(context: WebknossosTestContext) {
  const { mocks } = context;

  const backendMock = new BackendMock([
    // { position: [0, 0, 0], value: 1337 },
    { position: [1, 1, 1], value: 1 },
    { position: [2, 2, 2], value: 2 },
    { position: [3, 3, 3], value: 3 },
    { position: [4, 4, 4], value: 4 },
    { position: [5, 5, 5], value: 5 },
    { position: [6, 6, 6], value: 6 },
    { position: [7, 7, 7], value: 7 },
  ]);

  vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    backendMock.sendJSONReceiveArraybufferWithHeaders,
  );
  mocks.getCurrentMappingEntriesFromServer.mockImplementation(
    backendMock.getCurrentMappingEntriesFromServer,
  );
  mocks.acquireAnnotationMutex.mockImplementation(backendMock.acquireAnnotationMutex);
  backendMock.receivedDataPerSaveRequest = context.receivedDataPerSaveRequest;
  mocks.sendSaveRequestWithToken.mockImplementation(backendMock.sendSaveRequestWithToken);
  mocks.getUpdateActionLog.mockImplementation(backendMock.getUpdateActionLog);

  return backendMock;
}

describe("Proofreading", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it.skip("[new] should merge two agglomerates optimistically and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.addOnSavedListener(() => {
      if (backendMock.updateActionLog.at(-1)?.version === 6) {
        // As soon as the backend receives version 6, we will immediately
        // save version 7 here (simulating another user).
        backendMock.sendSaveRequestWithToken("unused", {
          data: [
            {
              version: 7,
              timestamp: 0,
              authorId: "authorId",
              transactionId: "transactionId",
              transactionGroupIndex: 0,
              transactionGroupCount: 1,
              stats: undefined,
              info: "",
              actions: [
                {
                  name: "mergeAgglomerate",
                  value: {
                    actionTracingId: "volumeTracingId",
                    segmentId1: 5,
                    segmentId2: 6,
                  },
                },
              ],
            },
          ],
        });
      }
    });

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield call(createEditableMapping);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
      yield take("FINISH_MAPPING_INITIALIZATION");
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(expectedMappingAfterMergeRebase);
    });

    await task.toPromise();
  }, 8000);

  it("[new] should merge two agglomerates optimistically and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.addOnSavedListener(() => {
      if (backendMock.updateActionLog.at(-1)?.version === 6) {
        // As soon as the backend receives version 6, we will immediately
        // save version 7 here (simulating another user).
        backendMock.sendSaveRequestWithToken("unused", {
          data: [
            {
              version: 7,
              timestamp: 0,
              authorId: "authorId",
              transactionId: "transactionId",
              transactionGroupIndex: 0,
              transactionGroupCount: 1,
              stats: undefined,
              info: "",
              actions: [
                {
                  name: "splitAgglomerate",
                  value: {
                    actionTracingId: "volumeTracingId",
                    segmentId1: 3,
                    segmentId2: 2,
                  },
                },
              ],
            },
          ],
        });
      }
    });

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield call(createEditableMapping);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
      yield take("FINISH_MAPPING_INITIALIZATION");
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 8],
          [2, 8],
          [3, 1],
          [4, 8],
          [5, 8],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  // todop
  it.skip("should merge two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            // agglomerateId1: 10,
            // agglomerateId2: 11,
            segmentId1: 1,
            segmentId2: 4,
            // mag: [1, 1, 1],
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  // todop
  it.skip("should split two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Prepare the server's reply for the upcoming split.
      vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [1, 1, 1],
            position2: [2, 2, 2],
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );
      // Already prepare the server's reply for mapping requests that will be sent
      // after the split.
      mocks.getCurrentMappingEntriesFromServer.mockReturnValue([
        [1, 9],
        [2, 10],
        [3, 10],
      ]);

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 10));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 10,
            segmentId1: 1,
            segmentId2: 2,
            // mag: [1, 1, 1],
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  // todop
  it.skip("should update the mapping when the server has a new update action with a merge operation", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      yield call(tryToIncorporateActions, [
        {
          version: 1,
          value: [
            {
              name: "mergeAgglomerate",
              value: {
                actionTracingId: "volumeTracingId",
                actionTimestamp: 0,
                // agglomerateId1: 10,
                // agglomerateId2: 11,
                segmentId1: 1,
                segmentId2: 4,
                // mag: [1, 1, 1],
              },
            },
          ],
        },
      ]);

      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);

  // todop
  it.skip("should update the mapping when the server has a new update action with a split operation", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield call(() => api.tracing.save());
      context.receivedDataPerSaveRequest = [];

      // Already prepare the server's reply for mapping requests that will be sent
      // after the split.
      mocks.getCurrentMappingEntriesFromServer.mockReturnValue([
        [1, 9],
        [2, 10],
        [3, 10],
      ]);

      yield call(tryToIncorporateActions, [
        {
          version: 1,
          value: [
            {
              name: "splitAgglomerate",
              value: {
                actionTracingId: "volumeTracingId",
                actionTimestamp: 0,
                // agglomerateId: 10,
                segmentId1: 1,
                segmentId2: 2,
                // mag: [1, 1, 1],
              },
            },
          ],
        },
      ]);

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      expect(context.receivedDataPerSaveRequest).toEqual([]);
    });

    await task.toPromise();
  }, 8000);
});
