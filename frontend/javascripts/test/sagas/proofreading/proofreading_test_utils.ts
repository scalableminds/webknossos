import type { MinCutTargetEdge, NeighborInfo } from "admin/rest_api";
import type { RequestOptionsWithData } from "libs/request";
import isEqual from "lodash-es/isEqual";
import sortBy from "lodash-es/sortBy";
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
import { delay } from "typed-redux-saga";
import type { APIUpdateActionBatch } from "types/api_types";
import type { Vector2, Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import {
  cutAgglomerateFromNeighborsAction,
  minCutPartitionsAction,
  proofreadAtPosition,
  toggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import { setMappingAction, updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import { setBusyBlockingInfoAction, setToolAction } from "viewer/model/actions/ui_actions";
import {
  applyVolumeUpdateActionsFromServerAction,
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { createEditableMapping } from "viewer/model/sagas/volume/proofreading/proofread_saga";
import type {
  ApplicableSkeletonServerUpdateAction,
  ApplicableVolumeServerUpdateAction,
  ServerUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { NumberLike, SaveQueueEntry, Segment, WebknossosState } from "viewer/store";
import { combinedReducer } from "viewer/store";
import { expect, vi } from "vitest";
import { edgesForInitialMapping, initialMapping } from "./proofreading_fixtures";
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
  const currentMag = yield* select((state) => getCurrentMag(state, tracingId));
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
  injectionsPerVersion: Record<number, UpdateActionWithoutIsolationRequirement[]> = {};

  // TODO (could be done in #9036 or later):
  // This is a reference to the same variable that is
  // set up in apiHelpers. We should probably try to remove this
  // variable here and instead use `backendMock.updateActionLog`
  // everywhere which is mostly equivalent.
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
    // The injected version has already been reached, directly inject!
    const currentVersion = this.updateActionLog.at(-1)?.version || 1;
    if (currentVersion === targetVersion - 1) {
      this.injectVersion(updateActions, targetVersion);
    } else if (currentVersion > targetVersion - 1) {
      throw new Error(
        `Requested to inject an update for version ${targetVersion} but current version is already at ${currentVersion}.`,
      );
    } else {
      this.addOnSavedListener(() => {
        if (this.updateActionLog.at(-1)?.version === targetVersion - 1) {
          this.injectVersion(updateActions, targetVersion);
        }
      });
    }
    this.injectionsPerVersion[targetVersion] = updateActions;
  }

  planMultipleVersionInjections(
    startingVersion: number,
    updateActionBatches: UpdateActionWithoutIsolationRequirement[][],
  ) {
    // Injects each passed update action batch subsequently starting with version startingVersion.
    updateActionBatches.forEach((actions, index) => {
      this.planVersionInjection(startingVersion + index, actions);
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

  getEditableAgglomerateSkeleton = async (
    _tracingStoreUrl: string,
    tracingId: string,
    agglomerateId: number,
  ): Promise<ArrayBuffer> => {
    // Does not currently support versioning as this would require a versioned adjacency list.
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
      agglomerateId,
      tracingId,
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

export function* makeMappingEditableHelper(): Saga<void> {
  // Usually the user creates an editable mapping via the first proofreading action.
  // Therefore the context is busy blocked by the proofreading saga.
  // As we do this manually here, we need to mock that wk is busy.
  yield put(setBusyBlockingInfoAction(true, "Blocking in test for making mapping editable"));
  yield call(createEditableMapping);
  yield put(setBusyBlockingInfoAction(false));
  // Delay is needed to avoid the auto mapping data reloading of mapping saga to interfere with tests.
  // Some tests check whether the missing agglomerate ids not present in the partial mapping in the frontend
  // are actually loaded during rebasing. Such a scenario might happen when doing proofreading via meshes.
  // But without the delay the mapping saga will directly replace the mapping (including the new mapping info form the rebasing)
  // directly after the rebasing with a version where the additionally loaded segments are not present as they are "off screen".
  // The delay gives the mapping saga time to do the update now instead of the tests directly starting the proofreading interaction and thus rebasing.
  // This would delay the reloading of the partial mapping of the mapping saga, thus we wait here shortly manually.
  yield delay(10);
}

export function prepareGetNeighborsForAgglomerateNode(
  mocks: WebknossosTestContext["mocks"],
  expectedVersion: number,
  includeSegmentIdToOne: boolean,
) {
  // Prepare getNeighborsForAgglomerateNode mock
  mocks.getNeighborsForAgglomerateNode.mockImplementation(
    async (
      _tracingStoreUrl: string,
      _tracingId: string,
      version: number,
      segmentInfo: {
        segmentId: NumberLike;
        mag: Vector3;
        agglomerateId: NumberLike;
        editableMappingId: string;
      },
    ): Promise<NeighborInfo> => {
      if (version !== expectedVersion) {
        throw new Error(
          `Version mismatch. Expected requested version to be ${expectedVersion} but got ${version}`,
        );
      }
      if (segmentInfo.segmentId === 2) {
        const neighbors = includeSegmentIdToOne
          ? [
              {
                segmentId: 1,
                position: [1, 1, 1] as Vector3,
              },
              {
                segmentId: 3,
                position: [3, 3, 3] as Vector3,
              },
            ]
          : [
              {
                segmentId: 3,
                position: [3, 3, 3] as Vector3,
              },
            ];
        return {
          segmentId: 2,
          neighbors,
        };
      }
      return {
        segmentId: Number.parseInt(segmentInfo.segmentId.toString(), 10),
        neighbors: [],
      };
    },
  );
}

export function* loadAgglomerateMeshes(agglomerateIds: number[]): Saga<void> {
  for (const id of agglomerateIds) {
    yield put(proofreadAtPosition([id, id, id]));
    yield take("FINISHED_LOADING_MESH");
  }
}
export function getAllCurrentlyLoadedMeshIds(
  context: WebknossosTestContext,
  volumeTracingId: string,
) {
  const loadedMeshIds = new Set();
  const { segmentMeshController } = context;
  const additionalCoordKey = "";
  const lodGroupsPerSegmentId =
    segmentMeshController.meshesGroupsPerSegmentId[additionalCoordKey][volumeTracingId];
  for (const lodGroup of Object.values(lodGroupsPerSegmentId)) {
    for (const group of Object.values(lodGroup))
      if ("segmentId" in group) {
        loadedMeshIds.add(group.segmentId);
      }
  }
  return loadedMeshIds;
}

export function* performCutFromAllNeighbours(
  context: WebknossosTestContext,
  tracingId: string,
  loadMeshes: boolean,
): Saga<void> {
  yield call(initializeMappingAndTool, context, tracingId);
  yield* expectMapping(tracingId, initialMapping);
  if (loadMeshes) {
    // Load all meshes for all affected agglomerate meshes and one more.
    yield loadAgglomerateMeshes([4, 6, 1]);

    const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
    expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);
  }
  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { anchorPosition: [2, 2, 2] }, tracingId));
  yield put(setActiveCellAction(1));

  yield makeMappingEditableHelper();
  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  yield* expectMapping(tracingId, initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));

  // Execute the actual merge and wait for the finished mapping.
  yield put(
    cutAgglomerateFromNeighborsAction(
      [2, 2, 2], // unmappedId=2 / mappedId=1 at this position
    ),
  );
  yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");
  yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Wait till full merge operation is done.
}

// All usages of this function should have an initial mapping with a agglomerate id 1 = 1-2-3-1337-1338-1.
// In case this needs to be changed, the updateSegmentAction and setActiveCellAction actions need to be adjusted.
export function* simulatePartitionedSplitAgglomeratesViaMeshes(
  context: WebknossosTestContext,
  loadMeshes: boolean,
): Saga<void> {
  const { tracingId } = yield* select((state) => state.annotation.volumes[0]);
  const expectedInitialMapping = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 4],
    [5, 4],
    [6, 6],
    [7, 6],
  ]);

  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield* select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(expectedInitialMapping);
  if (loadMeshes) {
    // Load all meshes for all affected agglomerate meshes and one more.
    yield loadAgglomerateMeshes([4, 6, 1]);

    const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
    expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);
  }

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1, undefined, null, 1));

  yield makeMappingEditableHelper();
  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield* select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(expectedInitialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));

  //Activate Multi-split tool
  yield put(updateUserSettingAction("isMultiSplitActive", true));
  // Select partition 1
  yield put(toggleSegmentInPartitionAction(1, 1, 1));
  yield put(toggleSegmentInPartitionAction(2, 1, 1));
  // Select partition 2
  yield put(toggleSegmentInPartitionAction(1337, 2, 1));
  yield put(toggleSegmentInPartitionAction(1338, 2, 1));
  // Execute the actual merge and wait for the finished mapping.
  yield put(minCutPartitionsAction());
  yield take("FINISH_MAPPING_INITIALIZATION");
  // Checking optimistic merge is not necessary as no "foreign" update was injected.
  yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Wait till full merge operation is done.
}

export const mockEdgesForPartitionedAgglomerateMinCut = (
  mocks: WebknossosTestContext["mocks"],
  expectedRequestedVersion: number,
) =>
  vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockImplementation(
    async (
      _tracingStoreUrl: string,
      _tracingId: string,
      version: number,
      segmentsInfo: {
        partition1: NumberLike[];
        partition2: NumberLike[];
        mag: Vector3;
        agglomerateId: NumberLike;
        editableMappingId: string;
      },
    ): Promise<Array<MinCutTargetEdge>> => {
      if (version !== expectedRequestedVersion) {
        throw new Error(
          `Unexpected version of min cut request. Expected version ${expectedRequestedVersion} but got ${version}`,
        );
      }
      const { agglomerateId, partition1, partition2 } = segmentsInfo;
      if (agglomerateId === 1 && isEqual(partition1, [1, 2]) && isEqual(partition2, [1337, 1338])) {
        return [
          {
            position1: [1, 1, 1],
            position2: [1338, 1338, 1338],
            segmentId1: 1,
            segmentId2: 1338,
          },
          {
            position1: [3, 3, 3],
            position2: [1337, 1337, 1337],
            segmentId1: 3,
            segmentId2: 1337,
          },
        ];
      }
      throw new Error("Unexpected min cut request");
    },
  );

export function* expectMapping(
  tracingId: string,
  expectedMapping: Map<number, number>,
): Saga<void> {
  const mapping0 = yield* select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(expectedMapping);
}

export function* expectSegmentList(
  tracingId: string,
  expectedSegments: Array<Partial<Segment> & { id: number }>,
): Saga<void> {
  const { segments } = yield* select((state) => getVolumeTracingById(state.annotation, tracingId));
  const expectedSegmentIds = expectedSegments.map((s) => s.id);
  const actualSegmentIds = Array.from(segments.keys() as Generator<number>);
  expect(actualSegmentIds.sort((a, b) => a - b)).toEqual(expectedSegmentIds.sort((a, b) => a - b));

  for (const expectedSegment of expectedSegments) {
    expect(segments.getNullable(expectedSegment.id) as Segment).toMatchObject(expectedSegment);
  }
}
