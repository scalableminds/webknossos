// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  getFlattenedUpdateActions,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { MinCutTargetEdge } from "admin/rest_api";
import isEqual from "lodash-es/isEqual";
import { actionChannel, call, put, take } from "redux-saga/effects";
import type { Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select, type Saga } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import {
  startSaga,
  type ActiveMappingInfo,
  type NumberLike,
  type WebknossosState,
} from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialMapping } from "./proofreading_fixtures";
import {
  expectSegmentList,
  getPositionForSegmentId,
  initializeMappingAndTool,
  makeMappingEditableForTest,
  mockEdgesForPartitionedAgglomerateMinCut,
  mockInitialBucketAndAgglomerateData,
  simulatePartitionedSplitAgglomeratesViaMeshes,
} from "./proofreading_test_utils";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import {
  mergeSegment1And4,
  mergeSegment5And6,
} from "./proofreading_interaction_update_action_fixtures";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_server_objects";

describe("Proofreading (with mesh actions)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function* simulateMergeAgglomeratesViaMeshes(
    context: WebknossosTestContext,
    injectVersionFn?: () => void,
  ): Saga<void> {
    const { api } = context;
    const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
    yield call(initializeMappingAndTool, context, tracingId);
    const mapping0 = yield* select(
      (state: WebknossosState) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(initialMapping);

    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
    yield put(setActiveCellAction(1, undefined, null, 1));

    yield call(makeMappingEditableForTest);

    // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
    const mapping1 = yield* select(
      (state: WebknossosState) =>
        (
          getMappingInfo(
            state.temporaryConfiguration.activeMappingByLayer,
            tracingId,
          ) as ActiveMappingInfo
        ).mapping,
    );
    expect(mapping1).toEqual(initialMapping);

    if (injectVersionFn != null) {
      yield call(injectVersionFn);
    }

    yield put(setCollaborationModeAction("Concurrent"));
    // Execute the actual merge and wait for the finished mapping.
    const finishMappingInitializationChannel = yield actionChannel("FINISH_MAPPING_INITIALIZATION");
    yield put(
      proofreadMergeAction(
        null, // mesh actions do not have a usable source position.
        1337,
        1337,
      ),
    );
    yield take(finishMappingInitializationChannel);
    // Checking optimistic merge is not necessary as no "foreign" update was injected.
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.

    const receivedUpdateActions = getFlattenedUpdateActions(context).slice(-2);

    expect(receivedUpdateActions).toEqual([
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1,
          segmentId2: 1337,
          agglomerateId1: 1,
          agglomerateId2: 1337,
        },
      },
      {
        name: "mergeSegmentItems",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1,
          segmentId2: 1337,
          agglomerateId1: 1,
          agglomerateId2: 1337,
        },
      },
    ]);
  }

  // Mesh interactions tests
  it(
    "should merge two agglomerates correctly even when merged segments are not loaded (such an action can be triggered via mesh proofreading)",
    { timeout: 6000 },
    async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* task(): Saga<void> {
        yield simulateMergeAgglomeratesViaMeshes(context);

        const finalMapping = yield* select(
          (state) =>
            getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
        );

        expect(finalMapping).toEqual(
          new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 4],
            [5, 4],
            [6, 6],
            [7, 6],
            // [1337, 1], not loaded due to no rebasing performed as this test has no injected updated actions.
            // If there would be injected updates (simulating other users' changes) the segment id 1337 would
            // been looked up for rebasing and thus added to the loaded mapping.
            // [1338, 1], not loaded
          ]),
        );
        yield call(() => context.api.tracing.save());

        yield* expectSegmentList(
          tracingId,
          [
            {
              id: 1,
              anchorPosition: [1, 1, 1],
            },
          ],
          _backendMock,
        );
      });

      await task.toPromise();
    },
  );

  it("should load unknown unmapped segment ids of mesh merge operation when incorporating interfered update actions.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const injectFn = () => backendMock.injectMultipleVersions(mergeSegment5And6, 7);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulateMergeAgglomeratesViaMeshes(context, injectFn);

      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
          [1337, 1], // loaded due to rebasing was necessary due to injected update action.
          // [1338, 1], not loaded
        ]),
      );

      yield* expectSegmentList(
        tracingId,
        [
          { id: 1, anchorPosition: getPositionForSegmentId(1) },
          { id: 4, anchorPosition: getPositionForSegmentId(5) }, // 5 is contained in agglomerate 4
        ],
        backendMock,
      );
    });
    await task.toPromise();
  });

  const mockEdgesForNormalAgglomerateMinCut = (mocks: WebknossosTestContext["mocks"]) =>
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
        if (version !== 6) {
          throw new Error("Unexpected version of min cut request:" + version);
        }
        const { agglomerateId, partition1, partition2 } = segmentsInfo;
        if (agglomerateId === 6 && isEqual(partition1, [1337]) && isEqual(partition2, [1338])) {
          return [
            {
              position1: getPositionForSegmentId(1337),
              position2: getPositionForSegmentId(1338),
              segmentId1: 1337,
              segmentId2: 1338,
            },
          ];
        }
        throw new Error("Unexpected min cut request");
      },
    );

  function* simulateSplitAgglomeratesViaMeshes(
    context: WebknossosTestContext,
    injectVersionFn?: () => void,
  ): Saga<void> {
    // Splits segments 1337 and 1338 which are assumed to both be mapped to agglomerate 6.
    const { api } = context;
    const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
    const expectedInitialMapping = new Map([
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 4],
      [5, 4],
      [6, 6],
      [7, 6],
    ]);

    yield call(initializeMappingAndTool, context, tracingId);
    const mapping0 = yield* select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping0).toEqual(expectedInitialMapping);

    // Set up the merge-related segment partners. Normally, this would happen
    // due to the user's interactions.
    yield put(updateSegmentAction(6, { anchorPosition: getPositionForSegmentId(1337) }, tracingId));
    yield put(setActiveCellAction(6, undefined, null, 1337));

    yield call(makeMappingEditableForTest);

    // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
    const mapping1 = yield* select(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
    );
    expect(mapping1).toEqual(expectedInitialMapping);

    if (injectVersionFn != null) {
      injectVersionFn();
    }

    yield put(setCollaborationModeAction("Concurrent"));
    // Execute the actual merge and wait for the finished mapping.
    yield put(
      minCutAgglomerateWithPositionAction(
        null, // mesh actions do not have a usable source position.
        1338,
        6,
      ),
    );
    yield take("FINISH_MAPPING_INITIALIZATION");
    yield take(
      ((action: any) =>
        action.type === "UNREGISTER_OPERATION" && action.id === "proofreading") as any,
    );

    // Checking optimistic merge is not necessary as no "foreign" update was injected.
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  }

  it("should update the mapping correctly if not loaded part of the mapping is changed due to own mesh split operation", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 6],
    //  [2, 6],
    //  [3, 6],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 6],
    //  [1338, 6]]
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [7, 1337],
        [1338, 1],
      ],
      Store.getState(),
    );

    mockEdgesForNormalAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulateSplitAgglomeratesViaMeshes(context);

      const splitOperationUpdateActions = getFlattenedUpdateActions(context).slice(-2);

      expect(splitOperationUpdateActions).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId: 6,
            segmentId1: 1337,
            segmentId2: 1338,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            id: 1339,
            anchorPosition: getPositionForSegmentId(1338),
            name: null,
            color: null,
            groupId: null,
            metadata: [],
            creationTime: 1494695001688,
          },
        },
      ]);
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          // [1337, 6], not loaded due to no rebasing performed as this test has no injected updated actions.
          // If there would be injected updates (simulating other users' changes) the segment id 1337 would
          // been looked up for rebasing and thus added to the loaded mapping.
          // [1338, 1339], also not loaded. see above.
        ]),
      );

      yield* expectSegmentList(
        tracingId,
        [
          {
            id: 6,
            anchorPosition: getPositionForSegmentId(1337), // 1337 is contained in agglomerate 6
          },
          {
            id: 1339,
            anchorPosition: getPositionForSegmentId(1338), // was split off
          },
        ],
        backendMock,
      );
    });

    await task.toPromise();
  });

  it("should load unknown unmapped segment ids of mesh split operation when incorporating interfered update actions.", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 6],
    //  [2, 6],
    //  [3, 6],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 6],
    //  [1338, 6]]
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [7, 1337],
        [1338, 1],
      ],
      Store.getState(),
    );

    const injectFn = () => backendMock.injectMultipleVersions(mergeSegment5And6, 7);

    mockEdgesForNormalAgglomerateMinCut(mocks);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulateSplitAgglomeratesViaMeshes(context, injectFn);

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect(receivedUpdateActions.slice(-3)).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            // Different to test above:
            agglomerateId: 4, // !Changed! due to interfered merge update action version 7. Would be aggloId 6,
            // but the merge made it a 4, because the split operation is after the injected version 7.
            segmentId1: 1337,
            segmentId2: 1338,
          },
        },
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: "volumeTracingId",
            id: 4,
            anchorPosition: getPositionForSegmentId(1337),
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            additionalCoordinates: undefined,
            anchorPosition: getPositionForSegmentId(1338),
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1339,
            metadata: [],
            name: null,
          },
        },
      ]);

      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
          // Same here not loaded due to no rebasing
          [1337, 4], // loaded due to split mesh operation
          [1338, 1339], // loaded due to split mesh operation
        ]),
      );

      yield* expectSegmentList(
        tracingId,
        [
          { id: 4, anchorPosition: [100, 100, 100] },
          { id: 1339, anchorPosition: [101, 101, 101] },
        ],
        backendMock,
      );
    });

    await task.toPromise();
  });

  it("should perform partitioned min-cut correctly", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Thus, there should be the following circle of edges: 1-2-3-1337-1338-1.
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [1, 1338],
        [3, 1337],
      ],
      Store.getState(),
    );

    mockEdgesForPartitionedAgglomerateMinCut(mocks, 6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context, false);

      const receivedUpdateActions = getFlattenedUpdateActions(context);
      expect(receivedUpdateActions.slice(-3)).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId: 1,
            segmentId1: 1,
            segmentId2: 1338,
          },
        },
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId: 1,
            segmentId1: 3,
            segmentId2: 1337,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            additionalCoordinates: undefined,
            anchorPosition: getPositionForSegmentId(1338),
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1339,
            metadata: [],
            name: null,
          },
        },
      ]);
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          [1337, 1339], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338, 1339], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );

      yield* expectSegmentList(
        tracingId,
        [
          {
            id: 1,
            anchorPosition: getPositionForSegmentId(1),
          },
          {
            id: 1339,
            anchorPosition: getPositionForSegmentId(1338), // segment 1338 is in agglomerate 1339
          },
        ],
        backendMock,
      );
    });

    await task.toPromise();
  });

  it("should result in not partitioned min cut if min-cutted edges are outdated due to interfering merge operations.", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    // Initial mapping should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Thus, there should be the following circle of edges: 1-2-3-1337-1338-1.
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [1, 1338],
        [3, 1337],
      ],
      Store.getState(),
    );

    // Mapping after interference should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 1],
    //  [5, 1],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Contains two circles now but only one is split by the min-cut request.
    const injectFn = () =>
      backendMock.injectMultipleVersions(
        [
          ...mergeSegment1And4,
          // The following update action is not imported from a fixture,
          // because such a "double-merge" is not really provokable from the UI
          // currently. There is the fixture `mergeSegment1337And5`, but it
          // also contains a createSegment action which does not make sense
          // in the already-merged state.
          // Therefore, we use a handcoded update action here.
          [
            {
              name: "mergeAgglomerate",
              value: {
                actionTracingId: VOLUME_TRACING_ID,
                segmentId1: 5,
                segmentId2: 1337,
                agglomerateId1: 1,
                agglomerateId2: 1,
              },
            },
          ],
        ],
        7,
      );

    mockEdgesForPartitionedAgglomerateMinCut(mocks, 6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context, false, injectFn);

      const receivedUpdateActions = getFlattenedUpdateActions(context);
      expect(receivedUpdateActions.slice(-2)).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId: 1,
            segmentId1: 1,
            segmentId2: 1338,
          },
        },
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId: 1,
            segmentId1: 3,
            segmentId2: 1337,
          },
        },
      ]);
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
          [6, 6],
          [7, 6],
          [1337, 1], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338, 1], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );

      yield* expectSegmentList(
        tracingId,
        [
          {
            id: 1,
            anchorPosition: getPositionForSegmentId(1),
          },
        ],
        backendMock,
      );
    });

    await task.toPromise();
  });
});
