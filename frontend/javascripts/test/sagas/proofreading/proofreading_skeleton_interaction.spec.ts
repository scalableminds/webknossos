// biome-ignore assist/source/organizeImports: VOLUME_TRACING_ID after apiHelpers.
import type { MinCutTargetEdge } from "admin/rest_api";
import { call, put } from "redux-saga/effects";
import { SKELETON_TRACING_ID } from "test/fixtures/skeletontracing_server_objects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import { WkDevFlags } from "viewer/api/wk_dev";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import {
  type SaveQueueEntry,
  type SkeletonTracing,
  startSaga,
  type WebknossosState,
} from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mergeSegment3And4WithAgglomerateTree1,
  mergeSegment3And4WithAgglomerateTree1And4,
  mergeSegment3And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1And4,
  splitSegment1And2WithAgglomerateTree1,
  splitSegment2And3WithAgglomerateTree1,
} from "./proofreading_interaction_update_action_fixtures";
import {
  loadAgglomerateSkeletons,
  mockEdgesForAgglomerateMinCut,
  performMergeTreesProofreading,
  performMinCutWithNodesProofreading,
  performSplitTreesProofreading,
} from "./proofreading_skeleton_test_utils";
import {
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

function assertUpdatesMatchInjectedUpdates(
  testUpdates: SaveQueueEntry[][],
  injectedUpdates: UpdateActionWithoutIsolationRequirement[][],
  startVersion: number,
) {
  expect(testUpdates.length).toBe(injectedUpdates.length);
  for (let i = 0; i < testUpdates.length; ++i) {
    expect(testUpdates[i][0].actions).toEqual(injectedUpdates[i]);
    expect(testUpdates[i][0].version).toEqual(startVersion + i);
  }
}

describe("Proofreading (With Agglomerate Skeleton interactions)", () => {
  const initialLiveCollab = WkDevFlags.liveCollab;
  beforeEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = initialLiveCollab;
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should mock loading agglomerate skeletons correctly", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context);
    const task = startSaga(function* task() {
      const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield makeMappingEditableHelper();

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      // Load agglomerate skeleton for agglomerate id 1.
      yield call(loadAgglomerateSkeletons, context, [1, 4], false, false);
      const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
        (state: WebknossosState) => state.annotation.skeleton,
      );
      const agglomerateTrees = Array.from(
        skeletonWithAgglomerateTrees.trees
          .values()
          .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.length).toBe(2);
      const sourceNode = agglomerateTrees[0].nodes.getOrThrow(6);
      expect(sourceNode.untransformedPosition).toStrictEqual([3, 3, 3]);
      const targetNode = agglomerateTrees[1].nodes.getOrThrow(7);
      expect(targetNode.untransformedPosition).toStrictEqual([4, 4, 4]);
    });
    await task.toPromise();
  });

  describe.each([
    false,
    true,
  ])("With shouldSaveAfterLoadingTrees=%s", (shouldSaveAfterLoadingTrees: boolean) => {
    it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
      const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
      backendMock.planMultipleVersionInjections(9, mergeSegment5And6WithAgglomerateTree1And4);

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* task() {
        yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
        const injectedMergeUpdates = context.receivedDataPerSaveRequest.slice(4, 8);
        assertUpdatesMatchInjectedUpdates(
          injectedMergeUpdates,
          mergeSegment5And6WithAgglomerateTree1And4,
          9,
        );

        const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(-4)!;
        yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
          "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_simple.json",
        );
        const finalMapping = yield select(
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
            [6, 1],
            [7, 1],
          ]),
        );
      });

      await task.toPromise();
    }, 8000);
  });

  it("should not merge two agglomerate skeletons if interfering merge makes it a no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, mergeSegment3And4WithAgglomerateTree1And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = true;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const injectedMergeUpdates = context.receivedDataPerSaveRequest.slice(4, 8);
      assertUpdatesMatchInjectedUpdates(
        injectedMergeUpdates,
        mergeSegment3And4WithAgglomerateTree1And4,
        9,
      );
      yield call(() => context.api.tracing.save()); // Ensure no unsaved changes in save queue.
      const allReceivedUpdates = getNestedUpdateActions(context);
      // Expect no further updates after the injected updates as the own proofreading operation became a no-op.
      expect(allReceivedUpdates.length).toEqual(11);

      const finalMapping = yield select(
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
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should split agglomerate skeleton and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    backendMock.planMultipleVersionInjections(8, splitSegment1And2WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      const injectedSplitAndTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 6);
      assertUpdatesMatchInjectedUpdates(
        injectedSplitAndTreeUpdateRequest,
        splitSegment1And2WithAgglomerateTree1,
        8,
      );
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(9);
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_simple.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1340],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should split an agglomerate skeleton and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    backendMock.planMultipleVersionInjections(8, mergeSegment3And6WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      yield call(() => context.api.tracing.save());
      const injectedMergeAndTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 7)!;
      assertUpdatesMatchInjectedUpdates(
        injectedMergeAndTreeUpdateRequest,
        mergeSegment3And6WithAgglomerateTree1,
        8,
      );
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(10);
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_interfered_merge.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 and 6 were merged and then split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1339],
          [4, 4],
          [5, 4],
          [6, 1339],
          [7, 1339],
        ]),
      );
    });

    await task.toPromise();
  });

  // TODOM: createSegment is sent twice to the server for id 1.
  // Talk with philipp:  reason:  this test initially already adds agglo 1 to the segment list.
  // But the test generating splitSegment2And3WithAgglomerateTree1 instead has agglo 4 in the segment list.
  // So, what should we do? Just accept and write a comment or fix this in this test or in the "splitSegment2And3WithAgglomerateTree1" generating test?
  it("should split two agglomerate skeletons if interfering split makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    backendMock.planMultipleVersionInjections(8, splitSegment2And3WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      yield call(() => context.api.tracing.save()); // TODOM remove later.
      const injectedMergeRequest = context.receivedDataPerSaveRequest.slice(3, 7);
      assertUpdatesMatchInjectedUpdates(
        injectedMergeRequest,
        splitSegment2And3WithAgglomerateTree1,
        8,
      );
      // Expect no more updates after the injected updates:
      const lastUpdateRequest = context.receivedDataPerSaveRequest.at(-1)![0];
      expect(lastUpdateRequest.version).toEqual(11); // TODOM: The 11th update action should be an updateSegmentsPartial
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 was split twice between 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  });

  it("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks, 10, [
      {
        position1: [3, 3, 3],
        position2: [1, 1, 1],
        segmentId1: 3,
        segmentId2: 1,
      } as MinCutTargetEdge,
    ]);

    backendMock.planMultipleVersionInjections(8, mergeSegment5And6WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.slice(3, 6);
      assertUpdatesMatchInjectedUpdates(
        injectedMergeRequest,
        mergeSegment5And6WithAgglomerateTree1,
        8,
      );
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        getNestedUpdateActions(context).slice(-7);
      yield expect(splitTreeAndAgglomerateAndDeleteSegmentActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/min_cut_nodes_skeleton_simple.json",
      );

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 4 and 6 were merged and then agglomerate 1 was split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should try to min cut agglomerate via node ids but interfering merge adds new edge. Resulting mapping should be correct.", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());

    // Directly after saving that the agglomerate trees were loaded, inject a version which adds a new edge to agglomerate 1.
    backendMock.planMultipleVersionInjections(8, mergeSegment3And4WithAgglomerateTree1);

    // Mock backend answer telling saga to split edges 3-2 and 3-1 to separate segments 2 and 3 from each other.
    mockEdgesForAgglomerateMinCut(context.mocks, 11, [
      {
        position1: [3, 3, 3],
        position2: [1, 1, 1],
        segmentId1: 3,
        segmentId2: 1,
      } as MinCutTargetEdge,
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      const injectedMergeAnTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 7);
      assertUpdatesMatchInjectedUpdates(
        injectedMergeAnTreeUpdateRequest,
        mergeSegment3And4WithAgglomerateTree1,
        8,
      );

      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        getNestedUpdateActions(context).slice(-6);

      yield expect(splitTreeAndAgglomerateAndDeleteSegmentActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/min_cut_nodes_skeleton_more_complex.json",
      );

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 and 6 were merged and then split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1],
          [4, 1],
          [5, 1],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should try to min cut agglomerate via node ids but interfering merge adds new edge which is not cut. Resulting mapping should be correct.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Mock backend answer telling saga to split edges 3-2.
    mockEdgesForAgglomerateMinCut(context.mocks, 11);

    // Directly after saving that the agglomerate trees were loaded, inject a version which adds a new edge to agglomerate 1.
    // Thus, the split operation should be incomplete resulting in no split at all.
    // Currently, this cannot be achieved with the code as proofreading interactions which would add a cycle are auto blocked
    // as this would be a merge interaction within the same agglomerate.
    // We still test this here to be sure, that this edge case is also handled correctly. Thus, a manual definition of the update actions is needed here.
    const injectedMergeAndTreeUpdate = [
      [
        {
          name: "mergeAgglomerate" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 1,
            segmentId2: 3,
            agglomerateId1: 1,
            agglomerateId2: 1,
          },
        },
      ],
      [
        {
          name: "mergeSegmentItems" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId1: 1,
            agglomerateId2: 1,
            segmentId1: 1,
            segmentId2: 3,
          },
        },
      ],
      [
        {
          name: "createEdge" as const,
          value: {
            actionTracingId: SKELETON_TRACING_ID,
            treeId: 3,
            source: 4,
            target: 6,
          },
        },
      ],
      [
        {
          name: "updateSegmentPartial" as const,
          value: {
            actionTimestamp: 0,
            actionTracingId: VOLUME_TRACING_ID,
            id: 1,
            anchorPosition: [3, 3, 3] as Vector3,
          },
        },
      ],
    ];
    backendMock.planMultipleVersionInjections(8, injectedMergeAndTreeUpdate);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      const injectedMergeAndTreeUpdateRequests = context.receivedDataPerSaveRequest.slice(3, 7);
      assertUpdatesMatchInjectedUpdates(
        injectedMergeAndTreeUpdateRequests,
        injectedMergeAndTreeUpdate,
        8,
      );
      // Only 2 updates as only one of the the two edges is deleted and thus the updates consist only of a delete edge and split segment.
      // But the split operation is incomplete, that's why other updates are missing here.
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        getNestedUpdateActions(context).slice(-2);
      yield expect(splitTreeAndAgglomerateAndDeleteSegmentActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/min_cut_nodes_skeleton_incomplete.json",
      );

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 and 6 were merged and then split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);
});
