import type { MinCutTargetEdge } from "admin/rest_api";
import { ColoredLogger } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import range from "lodash-es/range";
import { call, put, take } from "redux-saga/effects";
import { readdir, unlink } from "fs/promises";
import path from "path";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { MappingVisualizer } from "test/helpers/mapping_visualizer";
import { WkDevFlags } from "viewer/api/wk_dev";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { minCutAgglomerateAction } from "viewer/model/actions/proofread_actions";
import { deleteEdgeAction, mergeTreesAction } from "viewer/model/actions/skeletontracing_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import {
  type NumberLike,
  type SkeletonTracing,
  startSaga,
  type WebknossosState,
} from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectedMappingAfterMerge, initialMapping } from "./proofreading_fixtures";
import {
  expectMapping,
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

function* performMergeTreesProofreading(
  context: WebknossosTestContext,
  shouldSaveAfterLoadingTrees: boolean,
): Generator<any, void, any> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  yield* expectMapping(tracingId, initialMapping);

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield call(createEditableMapping);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  yield* expectMapping(tracingId, initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  yield call(loadAgglomerateSkeletonAtPosition, [4, 4, 4]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  if (shouldSaveAfterLoadingTrees) {
    yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  }
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
  yield put(mergeTreesAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");

  yield* expectMapping(tracingId, expectedMappingAfterMerge);
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
}

// Loads agglomerate tree for agglomerate 1 and splits segments 2 and 3.
function* performSplitTreesProofreading(context: WebknossosTestContext): Generator<any, void, any> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  yield* expectMapping(tracingId, initialMapping);

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield call(createEditableMapping);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  yield* expectMapping(tracingId, initialMapping);

  yield put(setOthersMayEditForAnnotationAction(true));
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
    (state: WebknossosState) => state.annotation.skeleton,
  );
  const agglomerateTrees = Array.from(
    skeletonWithAgglomerateTrees.trees
      .values()
      .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
  );
  expect(agglomerateTrees.length).toBe(1);
  const sourceNode = agglomerateTrees[0].nodes.getOrThrow(5);
  expect(sourceNode.untransformedPosition).toStrictEqual([2, 2, 2]);
  const targetNode = agglomerateTrees[0].nodes.getOrThrow(6);
  expect(targetNode.untransformedPosition).toStrictEqual([3, 3, 3]);
  yield put(deleteEdgeAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");

  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
}

function* performMinCutWithNodesProofreading(
  context: WebknossosTestContext,
): Generator<any, void, any> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  yield* expectMapping(tracingId, initialMapping);

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield call(createEditableMapping);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  yield* expectMapping(tracingId, initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  yield call(loadAgglomerateSkeletonAtPosition, [3, 3, 3]);
  // Wait until skeleton saga has loaded the skeleton.
  yield take("ADD_TREES_AND_GROUPS");
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
    (state: WebknossosState) => state.annotation.skeleton,
  );
  const agglomerateTrees = Array.from(
    skeletonWithAgglomerateTrees.trees
      .values()
      .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
  );
  expect(agglomerateTrees.length).toBe(1);
  const targetNode = agglomerateTrees[0].nodes.getOrThrow(5);
  expect(targetNode.untransformedPosition).toStrictEqual([2, 2, 2]);
  const sourceNode = agglomerateTrees[0].nodes.getOrThrow(6);
  expect(sourceNode.untransformedPosition).toStrictEqual([3, 3, 3]);
  yield put(minCutAgglomerateAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");

  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
}

const mockEdgesForAgglomerateMinCut = (
  mocks: WebknossosTestContext["mocks"],
  onlyThreeOneEdge: boolean = false,
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
      if (version !== 7) {
        throw new Error("Unexpected version of min cut request:" + version);
      }
      const { agglomerateId, partition1, partition2 } = segmentsInfo;
      if (agglomerateId === 1 && isEqual(partition1, [3]) && isEqual(partition2, [2])) {
        return [
          {
            position1: [3, 3, 3],
            position2: [2, 2, 2],
            segmentId1: 3,
            segmentId2: 2,
          } as MinCutTargetEdge,
          onlyThreeOneEdge
            ? undefined
            : ({
                position1: [3, 3, 3],
                position2: [1, 1, 1],
                segmentId1: 3,
                segmentId2: 1,
              } as MinCutTargetEdge),
        ].filter((a) => a != null);
      }
      throw new Error("Unexpected min cut request");
    },
  );

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

  it("performMergeTreesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreesAndMergeUpdateActions = context.receivedDataPerSaveRequest[2];
      yield expect(loadTreesAndMergeUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/perform_merge_trees_proofreading_update_actions.json",
      );
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerate skeletons optimistically, perform the merge proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
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
    backendMock.planVersionInjection(7, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      console.error("requests length", context.receivedDataPerSaveRequest.length);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(2)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(7);
      // Includes loading of agglomerate trees and tree merging operation & agglomerate merge update
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
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
    const backendMock = mockInitialBucketAndAgglomerateData(context);
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
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees);
      // This includes the create agglomerate tree actions.
      console.error("requests length", context.receivedDataPerSaveRequest.length);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(9);
      // Should include agglomerate tree updates & mergeAgglomerate action.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
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

  it("should merge two agglomerate skeletons if interfering merge makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 3,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    };
    backendMock.planVersionInjection(9, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = true;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees);
      console.error("requests length", context.receivedDataPerSaveRequest.length);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(9);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/merge_skeleton_interfered_no-op.json",
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
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("performSplitTreesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreeUpdateActions = context.receivedDataPerSaveRequest[2];
      yield expect(loadAgglomerateTreeUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/load_agglomerate_tree_update_actions.json",
      );
    });

    await task.toPromise();
  }, 8000);

  it("should split agglomerate skeleton optimistically, perform the split proofreading action and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    const injectedSplit = {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    };
    backendMock.planVersionInjection(8, [injectedSplit]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedSplit]);
      expect(injectedMergeRequest.version).toEqual(8);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
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

  it("should split two agglomerate skeletons optimistically, perform the split proofreading action and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 3,
        segmentId2: 6,
        agglomerateId1: 1339,
        agglomerateId2: 6,
      },
    };
    backendMock.planVersionInjection(8, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(8);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.slice(4);
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

  it("should split two agglomerate skeletons if interfering merge makes it an no-op.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    const injectedSplit = {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 2,
        segmentId2: 3,
        agglomerateId: 1,
      },
    };
    backendMock.planVersionInjection(8, [injectedSplit]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedSplit]);
      expect(injectedMergeRequest.version).toEqual(8);
      // This includes the split action of the split agglomerate tree.
      const latestUpdateActionRequestPayload = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(latestUpdateActionRequestPayload).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/split_skeleton_interfered_no-op.json",
      );
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 1 was split twice between 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1339],
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
    const _backendMock = mockInitialBucketAndAgglomerateData(context);
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks);

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreeUpdateActions = context.receivedDataPerSaveRequest[2];
      yield expect(loadAgglomerateTreeUpdateActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/perform_min_cut_with_nodes_proofreading.json",
      );
    });

    await task.toPromise();
  }, 8000);

  it.only("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks);

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
    backendMock.planVersionInjection(8, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(8);
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        context.receivedDataPerSaveRequest.slice(4);
      yield expect(splitTreeAndAgglomerateAndDeleteSegmentActions).toMatchFileSnapshot(
        "./__snapshots__/proofreading_skeleton_interaction.spec.ts/min_cut_nodes_skeleton_simple.json",
      );

      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 4 and 6 were merged and then agglomerate 1 was splitted between segment 2 and 3.
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

      const viz = new MappingVisualizer(backendMock);
      const dir = "debug";
      const entries = yield call(readdir, dir, { withFileTypes: true });

      const files = entries.filter((entry) => entry.isFile());

      for (const file of files) {
        const filePath = path.join(dir, file.name);
        yield call(unlink, filePath);
      }

      // return;

      for (const version of range(backendMock.agglomerateMapping.currentVersion + 1)) {
        // ColoredLogger.logYellow("rendering version", version);
        viz.renderVersion(version, { outputPath: `version_${version}.json`, format: "json" });
        viz.renderVersion(version, { outputPath: dir + `/version_${version}.svg`, format: "dot" });
        //
      }
    });

    await task.toPromise();
  }, 8000);

  it("should try to min cut agglomerate via node ids but interfering merge adds new edge. Resulting mapping should be correct.", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks);

    // Directly after saving that the agglomerate trees were loaded, inject a version which adds a new edge to agglomerate 1.
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 3,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    };
    backendMock.planVersionInjection(8, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(8);
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        context.receivedDataPerSaveRequest.slice(4);
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

      const nestedUpdateActions = getNestedUpdateActions(context);
      // console.log("nestedUpdateActions", nestedUpdateActions)
      for (const [index, action] of nestedUpdateActions.entries()) {
        console.log(index + 2, action);
      }
    });

    await task.toPromise();
  }, 8000);

  it("should try to min cut agglomerate via node ids but interfering merge adds new edge which is not cut. Resulting mapping should be correct.", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // Mock backend answer telling saga to split edges 3-2.
    const onlyThreeOneEdge = true;
    mockEdgesForAgglomerateMinCut(context.mocks, onlyThreeOneEdge);

    // Directly after saving that the agglomerate trees were loaded, inject a version which adds a new edge to agglomerate 1.
    // Thus, the split operation should be incomplete resulting in no split at all.
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 1,
        segmentId2: 3,
        agglomerateId1: 1,
        agglomerateId2: 1,
      },
    };
    backendMock.planVersionInjection(8, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context);
      const injectedMergeRequest = context.receivedDataPerSaveRequest.at(3)![0];
      expect(injectedMergeRequest.actions).toEqual([injectedMerge]);
      expect(injectedMergeRequest.version).toEqual(8);
      const splitTreeAndAgglomerateAndDeleteSegmentActions =
        context.receivedDataPerSaveRequest.slice(4);
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
