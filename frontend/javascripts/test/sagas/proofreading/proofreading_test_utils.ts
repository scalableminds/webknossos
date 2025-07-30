import type { RequestOptionsWithData } from "libs/request";
import { sleep } from "libs/utils";
import { call, put, select, take } from "redux-saga/effects";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { powerOrga } from "test/fixtures/dummy_organization";
import { AgglomerateMapping } from "test/helpers/agglomerate_mapping_helper";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import type { APIUpdateActionBatch } from "types/api_types";
import Constants, { type Vector3, type Vector2 } from "viewer/constants";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import type {
  ServerUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { NumberLike, SaveQueueEntry } from "viewer/store";
import { expect, vi } from "vitest";
import { edgesForInitialMapping } from "./proofreading_fixtures";
import type { BucketOverride, WebknossosTestContext } from "test/helpers/apiHelpers";
import type { NeighborInfo } from "admin/rest_api";

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

class BackendMock {
  typedArrayClass = Uint16Array;
  fillValue = 1;
  requestDelay = 5;
  updateActionLog: APIUpdateActionBatch[] = [];
  onSavedListeners: Array<() => void> = [];
  agglomerateMapping: AgglomerateMapping;

  // todop: this is a reference to the same variable that is
  // set up in apiHelpers. when BackendMock is used in other tests,
  // too, it probably makes sense to remove it in favor of
  // `updateActionLog` which is mostly equivalent.
  receivedDataPerSaveRequest: Array<SaveQueueEntry[]> = [];

  constructor(
    public overrides: BucketOverride[],
    additionalEdges: Vector2[] = [],
  ) {
    this.agglomerateMapping = new AgglomerateMapping(
      edgesForInitialMapping.concat(additionalEdges),
      1, // the annotation's current version (as defined in hybridtracing_server_objects.ts)
    );
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
      version = this.agglomerateMapping.currentVersion;
      console.log("defaulting to version", version);
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
  getNeighborsForAgglomerateNode = async (
    _tracingStoreUrl: string,
    _tracingId: string,
    segmentInfo: {
      segmentId: NumberLike;
      mag: Vector3;
      agglomerateId: NumberLike;
      editableMappingId: string;
    },
  ): Promise<NeighborInfo> => {
    if (segmentInfo.segmentId === 2) {
      return {
        segmentId: 2,
        neighbors: [
          {
            segmentId: 3,
            position: [3, 3, 3],
          },
        ],
      };
    }
    return {
      segmentId: Number.parseInt(segmentInfo.segmentId.toString()),
      neighbors: [],
    };
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
  }

  injectVersion(updateActions: UpdateActionWithoutIsolationRequirement[], targetVersion: number) {
    // Theoretically, we could derive targetVersion from the currently stored version,
    // but making the version number explicit strengthens the assumptions that the
    // tests expect.
    this.sendSaveRequestWithToken("unused", {
      data: createSaveQueueFromUpdateActions([updateActions], 0, null, false, targetVersion),
    });
  }
}

export function mockInitialBucketAndAgglomerateData(
  context: WebknossosTestContext,
  additionalEdges: Vector2[] = [],
) {
  const { mocks } = context;

  const backendMock = new BackendMock(
    [
      { position: [100, 100, 100], value: 1337 },
      { position: [1, 1, 1], value: 1 },
      { position: [2, 2, 2], value: 2 },
      { position: [3, 3, 3], value: 3 },
      { position: [4, 4, 4], value: 4 },
      { position: [5, 5, 5], value: 5 },
      { position: [6, 6, 6], value: 6 },
      { position: [7, 7, 7], value: 7 },
    ],
    additionalEdges,
  );

  vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    backendMock.sendJSONReceiveArraybufferWithHeaders,
  );
  mocks.getCurrentMappingEntriesFromServer.mockImplementation(
    backendMock.getCurrentMappingEntriesFromServer,
  );
  mocks.acquireAnnotationMutex.mockImplementation(backendMock.acquireAnnotationMutex);
  mocks.getNeighborsForAgglomerateNode.mockImplementation(
    backendMock.getNeighborsForAgglomerateNode,
  );
  backendMock.receivedDataPerSaveRequest = context.receivedDataPerSaveRequest;
  mocks.sendSaveRequestWithToken.mockImplementation(backendMock.sendSaveRequestWithToken);
  mocks.getUpdateActionLog.mockImplementation(backendMock.getUpdateActionLog);

  return backendMock;
}
