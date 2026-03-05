import type { MinCutTargetEdge } from "admin/rest_api";
import { call, put } from "redux-saga/effects";
import { SKELETON_TRACING_ID } from "test/fixtures/skeletontracing_server_objects";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import { TreeTypeEnum } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { type SkeletonTracing, startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mergeSegment3And4WithAgglomerateTree1,
  mergeSegment3And4WithAgglomerateTree1And4,
  mergeSegment3And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1,
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

  it("performMergeTreesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreesAndMergeUpdateActions = getNestedUpdateActions(context).slice(-6)!;
      yield expect(loadTreesAndMergeUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/perform_merge_trees_proofreading_update_actions.json",
      );
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    };
    backendMock.planVersionInjection(9, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(4)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(9);
      // Includes loading of agglomerate trees and tree merging operation & agglomerate merge update
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(-3)!;
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

  it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate interfering other merge action from backend correctly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // TODOM: skeleton updates must be included as agglomerate tree is loaded (still relevant?)
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    };
    backendMock.planVersionInjection(9, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = true;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree actions.
      console.error("requests length", context.receivedDataPerSaveRequest.length);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(4)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(9);
      // Should include agglomerate tree updates & mergeAgglomerate action.
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(-3)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_interfered.json",
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

  it("should merge two agglomerate skeletons if interfering merge makes it a no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, mergeSegment3And4WithAgglomerateTree1And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = true;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.

      const injectedMergeAndTreeUpdateRequest = getNestedUpdateActions(context).slice(7, 9)!;
      expect(injectedMergeAndTreeUpdateRequest).toEqual(mergeSegment3And4WithAgglomerateTree1And4);
      yield call(() => context.api.tracing.save()); // Ensure no unsaved changes in save queue.
      const allReceivedUpdates = getNestedUpdateActions(context);
      // Expect no further updates after the injected updates as the own proofreading operation became a no-op.
      expect(allReceivedUpdates.length).toEqual(9);

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

  it("performSplitTreesProofreading should apply correct update actions when loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreeUpdateActions = getNestedUpdateActions(context).at(5);
      yield expect(loadAgglomerateTreeUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/load_agglomerate_tree_update_actions.json",
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
      // Enforce storing pending skeleton & segment updates before asserting.
      yield call(() => context.api.tracing.save());
      const injectedSplitAndTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 5);
      expect(injectedSplitAndTreeUpdateRequest[0][0].actions).toEqual(
        splitSegment1And2WithAgglomerateTree1[0],
      );
      expect(injectedSplitAndTreeUpdateRequest[0][0].version).toEqual(8);
      expect(injectedSplitAndTreeUpdateRequest[1][0].actions).toEqual(
        splitSegment1And2WithAgglomerateTree1[1],
      );
      expect(injectedSplitAndTreeUpdateRequest[1][0].version).toEqual(9);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(-2)!;
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

  it("should split two agglomerate skeletons and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    backendMock.planMultipleVersionInjections(8, mergeSegment3And6WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      yield call(() => context.api.tracing.save());
      const injectedMergeAndTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 5)!;
      expect(injectedMergeAndTreeUpdateRequest[0][0].actions).toEqual(
        mergeSegment3And6WithAgglomerateTree1[0],
      );
      expect(injectedMergeAndTreeUpdateRequest[0][0].version).toEqual(8);
      expect(injectedMergeAndTreeUpdateRequest[1][0].actions).toEqual(
        mergeSegment3And6WithAgglomerateTree1[1],
      );
      expect(injectedMergeAndTreeUpdateRequest[1][0].version).toEqual(9);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = getNestedUpdateActions(context).slice(-6);
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

  // TODOp (#9036): the same split update action is sent twice to the server
  it("should split two agglomerate skeletons if interfering split makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    backendMock.planMultipleVersionInjections(8, splitSegment2And3WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.slice(3, 5);
      yield call(() => context.api.tracing.save()); // Ensure no unsaved changes in save queue.
      expect(injectedMergeRequest[0][0].actions).toEqual(splitSegment2And3WithAgglomerateTree1[0]);
      expect(injectedMergeRequest[0][0].version).toEqual(8);
      expect(injectedMergeRequest[1][0].actions).toEqual(splitSegment2And3WithAgglomerateTree1[1]);
      expect(injectedMergeRequest[1][0].version).toEqual(9);
      // Expect no more updates after the injected updates:
      const lastUpdateRequest = context.receivedDataPerSaveRequest.at(-1)![0];
      expect(lastUpdateRequest.version).toEqual(9);
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

  it("performMinCutWithNodesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Mock backend answer telling saga to split edges 3-2.
    mockEdgesForAgglomerateMinCut(context.mocks, 7);

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreesAndSplitUpdateActions = getNestedUpdateActions(context).slice(-4);
      yield expect(loadAgglomerateTreesAndSplitUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/perform_min_cut_with_nodes_proofreading.json",
      );
    });

    await task.toPromise();
  }, 8000);

  // TODO (#9036): the loaded agglomerate skeleton doesnt have the same amount of edges as the actual agglomerate 1
  it("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks, 8, [
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
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual(mergeSegment5And6WithAgglomerateTree1[0]);
      expect(injectedMergeRequest.version).toEqual(8);
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        getNestedUpdateActions(context).slice(-5);
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
    mockEdgesForAgglomerateMinCut(context.mocks, 9, [
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
      const injectedMergeAnTreeUpdateRequest = context.receivedDataPerSaveRequest.slice(3, 5);
      expect(injectedMergeAnTreeUpdateRequest.length).toEqual(
        mergeSegment3And4WithAgglomerateTree1.length,
      );
      expect(injectedMergeAnTreeUpdateRequest[0][0].actions).toEqual(
        mergeSegment3And4WithAgglomerateTree1[0],
      );
      expect(injectedMergeAnTreeUpdateRequest[0][0].version).toEqual(8);
      expect(injectedMergeAnTreeUpdateRequest[1][0].actions).toEqual(
        mergeSegment3And4WithAgglomerateTree1[1],
      );
      expect(injectedMergeAnTreeUpdateRequest[1][0].version).toEqual(9);

      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        getNestedUpdateActions(context).slice(-5);
      const all = getNestedUpdateActions(context);
      console.log(all);
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
    // TODO (#9036): this test succeeds even though the final agglomerate skeleton is incorrect.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Mock backend answer telling saga to split edges 3-2.
    mockEdgesForAgglomerateMinCut(context.mocks, 9);

    // Directly after saving that the agglomerate trees were loaded, inject a version which adds a new edge to agglomerate 1.
    // Thus, the split operation should be incomplete resulting in no split at all.
    // Currently, this cannot be achieved with the code as proofreading interactions which would add a cycle are auto blocked
    // as this would be a merge interaction within the same agglomerate.
    // We still test this here to be sure, that this edge case is also handled correctly.
    const injectedMergeAndTreeUpdate = [
      [
        {
          name: "mergeAgglomerate" as const,
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 3,
            agglomerateId1: 1,
            agglomerateId2: 1,
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
    ];
    backendMock.planMultipleVersionInjections(8, injectedMergeAndTreeUpdate);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      const injectedMergeAndTreeUpdateRequests = context.receivedDataPerSaveRequest.slice(3, 5);
      expect(injectedMergeAndTreeUpdateRequests[0][0].actions).toEqual(
        injectedMergeAndTreeUpdate[0],
      );
      expect(injectedMergeAndTreeUpdateRequests[0][0].version).toEqual(8);
      expect(injectedMergeAndTreeUpdateRequests[1][0].actions).toEqual(
        injectedMergeAndTreeUpdate[1],
      );
      expect(injectedMergeAndTreeUpdateRequests[1][0].version).toEqual(9);
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
