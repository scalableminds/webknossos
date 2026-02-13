import type { RequestOptionsWithData } from "libs/request";
import { sleep } from "libs/utils";
import { call, put, take } from "redux-saga/effects";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { powerOrga } from "test/fixtures/dummy_organization";
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";
import {
  type BucketOverride,
  createBucketResponseFunction,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import type { APIUpdateActionBatch } from "types/api_types";
import Constants, { type Vector2, type Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import { applyVolumeUpdateActionsFromServerAction } from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import type {
  ApplicableSkeletonServerUpdateAction,
  ApplicableVolumeServerUpdateAction,
  ServerUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { SaveQueueEntry, WebknossosState } from "viewer/store";
import { combinedReducer } from "viewer/store";
import { expect, vi } from "vitest";
import { edgesForInitialMapping } from "./proofreading_fixtures";
import {
  createSkeletonTracingFromAdjacency,
  encodeServerTracing,
} from "./proofreading_skeleton_test_utils";

export function* initializeMappingAndTool(
  context: WebknossosTestContext,
  tracingId: string,
): Saga<void> {
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
  yield put(setMappingAction(tracingId, sampleHdf5AgglomerateName, "HDF5", false));
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

export class BackendMock {
  typedArrayClass = Uint16Array;
  fillValue = 1;
  requestDelay = 5;
  updateActionLog: APIUpdateActionBatch[] = [];
  onSavedListeners: Array<() => void> = [];
  agglomerateMapping: AgglomerateMapping;
  injectionsPerVersion: Record<number, UpdateActionWithoutIsolationRequirement[]> = {}

  // todop: this is a reference to the same variable that is
  // set up in apiHelpers. when BackendMock is used in other tests,
  // too, it probably makes sense to remove it in favor of
  // `updateActionLog` which is mostly equivalent.
  receivedDataPerSaveRequest: Array<SaveQueueEntry[]> = [];

  constructor(
    public overrides: BucketOverride[],
    additionalEdges: Vector2[] = [],
    private initialState: WebknossosState | undefined = undefined,
  ) {
    this.agglomerateMapping = new AgglomerateMapping(
      edgesForInitialMapping.concat(additionalEdges),
      1, // the annotation's current version (as defined in hybridtracing_server_objects.ts)
    );
  }

  getState(requestedVersion: number | null = null): WebknossosState {
    let state = this.initialState;
    if (state == null) {
      throw new Error("Unexpected getState on BackendMock.");
    }
    for (const actionBatch of this.getLocalUpdateActionLog(requestedVersion)) {
      state = combinedReducer(
        state,
        applySkeletonUpdateActionsFromServerAction(
          actionBatch.value as ApplicableSkeletonServerUpdateAction[],
          true,
        ),
      );
      state = combinedReducer(
        state,
        applyVolumeUpdateActionsFromServerAction(
          actionBatch.value as ApplicableVolumeServerUpdateAction[],
          true,
        ),
      );
    }

    return state;
  }

  getLocalUpdateActionLog(requestedVersion: number | null = null, until: boolean = true) {
    let state = this.initialState;
    if (state == null) {
      throw new Error("Unexpected getState on BackendMock.");
    }

    if (requestedVersion === null) {
      return this.updateActionLog;
    }

    const untilPredicate = until
      ? (version: number) => version <= requestedVersion
      : (version: number) => version === requestedVersion;

    return this.updateActionLog.filter((actionBatch) => {
      return requestedVersion == null || untilPredicate(actionBatch.version);
    });
  }

  private addOnSavedListener = (fn: () => void) => {
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
      version = this.agglomerateMapping.currentVersion;
    }
    // This function should always return the full current mapping.
    // The values will be filtered according to the requested keys
    // in `getAgglomeratesForSegmentsImpl`.
    const mapping = this.agglomerateMapping.getMap(version).entries().toArray();

    return mapping;
  };

  acquireAnnotationMutex = async (_annotationId: string) => {
    return { canEdit: true, blockedByUser: null };
  };
  releaseAnnotationMutex = async (_annotationId: string) => {};

  private saveQueueEntriesToUpdateActionBatch = (data: Array<SaveQueueEntry>) => {
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
    if (payload.data[0].version !== this.agglomerateMapping.currentVersion + 1) {
      throw new Error("Version mismatch");
    }
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
      console.log(`Updating mocked server to: v=${item.version} with`, item.value);
      let isFirstUpdateAction = true;
      for (const updateAction of item.value) {
        const bumpVersion = isFirstUpdateAction;
        if (updateAction.name === "mergeAgglomerate") {
          if (updateAction.value.segmentId1 == null || updateAction.value.segmentId2 == null) {
            throw new Error("Segment Id is null");
          }
          this.agglomerateMapping.addEdge(
            updateAction.value.segmentId1,
            updateAction.value.segmentId2,
            bumpVersion,
          );
          isFirstUpdateAction = false;
        } else if (updateAction.name === "splitAgglomerate") {
          if (updateAction.value.segmentId1 == null || updateAction.value.segmentId2 == null) {
            throw new Error("Segment Id is null");
          }
          this.agglomerateMapping.removeEdge(
            updateAction.value.segmentId1,
            updateAction.value.segmentId2,
            bumpVersion,
          );
          isFirstUpdateAction = false;
        } else {
          // We need the agglomerate mapping to be in sync
          if (bumpVersion) {
            this.agglomerateMapping.bumpVersion();
          }
          isFirstUpdateAction = false;
        }
      }

      if (item.version !== this.agglomerateMapping.currentVersion) {
        throw new Error(
          `Mismatch in received version and agglomerateMapping.currentVersion (${item.version} vs ${this.agglomerateMapping.currentVersion}). This is likely a bug in the mocking code.`,
        );
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
    _truncateActionLog: boolean = false,
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

  getPositionForSegmentInAgglomerate = async (
    _datastoreUrl: string,
    _datasetId: string,
    _layerName: string,
    _mappingName: string,
    segmentId: number,
  ): Promise<Vector3> => {
    return [segmentId, segmentId, segmentId];
  };

  planVersionInjection(
    targetVersion: number,
    updateActions: UpdateActionWithoutIsolationRequirement[],
  ) {
    /*
     * As soon as the backend (mock) receives the version that precedes
     * the targetVersion, we will immediately save a new version here
     * with the provided updateActions.
     * This method can be used to simulate another user which saves in between,
     * forcing the client that is tested to pull in the newer version before
     * saving can finish.
     */
    this.addOnSavedListener(() => {
      if (this.updateActionLog.at(-1)?.version === targetVersion - 1) {
        this.injectVersion(updateActions, targetVersion);
      }
    });
    this.injectionsPerVersion[targetVersion] = updateActions;
  }

  injectVersion(updateActions: UpdateActionWithoutIsolationRequirement[], targetVersion: number) {
    // Theoretically, we could derive targetVersion from the currently stored version,
    // but making the version number explicit strengthens the assumptions that the
    // tests expect.
    this.sendSaveRequestWithToken("unused", {
      data: createSaveQueueFromUpdateActions([updateActions], 0, null, false, targetVersion),
    });
  }

  getEditableAgglomerateSkeleton = async (
    _tracingStoreUrl: string,
    _tracingId: string,
    agglomerateId: number,
  ): Promise<ArrayBuffer> => {
    const version = this.agglomerateMapping.currentVersion;
    const adjacencyList = this.agglomerateMapping.getAdjacencyList(version);
    const mapping = this.agglomerateMapping.getMap(version).entries().toArray();
    const someSegmentOfAgglomerate = mapping.find(
      ([_segment, agglomerate]) => agglomerate === agglomerateId,
    );
    if (!someSegmentOfAgglomerate) {
      throw new Error(
        `Could not find any segment pointing to agglomerate with id ${agglomerateId}!`,
      );
    }
    const segmentId = someSegmentOfAgglomerate[0];
    const agglomerateSkeletonAsServerTracing = createSkeletonTracingFromAdjacency(
      adjacencyList,
      segmentId,
      "agglomerateSkeleton",
      version,
    );

    return encodeServerTracing(agglomerateSkeletonAsServerTracing, "skeleton");
  };
}

export function mockInitialBucketAndAgglomerateData(
  context: WebknossosTestContext,
  additionalEdges: Vector2[] = [],
  initialState: WebknossosState | undefined = undefined,
) {
  const { mocks } = context;

  const backendMock = new BackendMock(
    [
      { position: [100, 100, 100], value: 1337 },
      { position: [101, 101, 101], value: 1338 },
      { position: [1, 1, 1], value: 1 },
      { position: [2, 2, 2], value: 2 },
      { position: [3, 3, 3], value: 3 },
      { position: [4, 4, 4], value: 4 },
      { position: [5, 5, 5], value: 5 },
      { position: [6, 6, 6], value: 6 },
      { position: [7, 7, 7], value: 7 },
    ],
    additionalEdges,
    initialState,
  );

  vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    createBucketResponseFunction(
      { color: "uint8", segmentation: "uint16" },
      backendMock.fillValue,
      backendMock.requestDelay,
      backendMock.overrides,
    ),
  );
  mocks.getCurrentMappingEntriesFromServer.mockImplementation(
    backendMock.getCurrentMappingEntriesFromServer,
  );
  mocks.acquireAnnotationMutex.mockImplementation(backendMock.acquireAnnotationMutex);
  mocks.releaseAnnotationMutex.mockImplementation(backendMock.releaseAnnotationMutex);
  backendMock.receivedDataPerSaveRequest = context.receivedDataPerSaveRequest;
  mocks.sendSaveRequestWithToken.mockImplementation(backendMock.sendSaveRequestWithToken);
  mocks.getUpdateActionLog.mockImplementation(backendMock.getUpdateActionLog);
  mocks.getPositionForSegmentInAgglomerate.mockImplementation(
    backendMock.getPositionForSegmentInAgglomerate,
  );
  mocks.getEditableAgglomerateSkeleton.mockImplementation(
    backendMock.getEditableAgglomerateSkeleton,
  );

  return backendMock;
}

export function* expectMapping(
  tracingId: string,
  expectedMapping: Map<number, number>,
): Saga<void> {
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(expectedMapping);
}
