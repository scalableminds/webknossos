// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import Deferred from "libs/async/deferred";
import { sleep } from "libs/utils";
import { call, put, take } from "redux-saga/effects";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { loadAgglomerateTreeAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPositionForSegmentId,
  initializeMappingAndTool,
  makeMappingEditableForTest,
  mockInitialBucketAndAgglomerateData,
  operationFinished,
  operationStarted,
} from "./proofreading_test_utils";

function* getAgglomerateTreeNodePositions(): Saga<Vector3[][]> {
  const trees = yield* select((state) =>
    getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
  );
  return Array.from(trees.values()).map((tree) =>
    Array.from(tree.nodes.values())
      .map((node) => node.untransformedPosition)
      .sort((a, b) => a[0] - b[0]),
  );
}

describe("Proofreading agglomerate tree loading", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should not run a proofreading action while an agglomerate tree is loading", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Restore original parsing of tracings to make the mocked agglomerate tree implementation work.
    vi.mocked(context.mocks.parseProtoTracing).mockRestore();
    // Deliver the agglomerate tree with a delay (e.g., because it's large) so that the user
    // can try to perform a proofreading action in the meantime.
    const treeRequestStarted = new Deferred<void, never>();
    const getTreeMock = vi.mocked(context.mocks.getEditableAgglomerateTreeAsSkeletonTracing);
    const originalImplementation = getTreeMock.getMockImplementation() as unknown as (
      tracingStoreUrl: string,
      tracingId: string,
      agglomerateId: bigint,
      version: number,
    ) => Promise<ArrayBuffer>;
    getTreeMock.mockImplementation(
      async (
        tracingStoreUrl: string,
        tracingIdArg: string,
        agglomerateId: bigint,
        version: number,
      ) => {
        const tree = await originalImplementation(
          tracingStoreUrl,
          tracingIdArg,
          agglomerateId,
          version,
        );
        treeRequestStarted.resolve();
        await sleep(500);
        return tree;
      },
    );

    const task = startSaga(function* (): Saga<void> {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      let didProofreadingStart = false;
      const proofreadingStartedTask = startSaga(function* () {
        yield take(operationStarted("PROOFREADING"));
        didProofreadingStart = true;
      });

      // Load the tree of agglomerate 1 (segments 1, 2, 3) and try to merge agglomerate 4
      // (segments 4, 5) into it while the tree is loading.
      yield call(loadAgglomerateTreeAtPosition, getPositionForSegmentId(1));
      yield call(() => treeRequestStarted.promise());
      const activeOperations = yield* select((state) => state.operationContext.activeOperations);
      expect(activeOperations.map((operation) => operation.id)).toEqual(["LOAD_AGGLOMERATE_TREE"]);

      yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
      yield take(operationFinished("LOAD_AGGLOMERATE_TREE"));

      // The merge was ignored, so the loaded tree matches the (unchanged) agglomerate.
      expect(didProofreadingStart).toBe(false);
      expect(yield* getAgglomerateTreeNodePositions()).toEqual([
        [1, 2, 3].map(getPositionForSegmentId),
      ]);

      // After the tree was loaded, merging works and updates the tree.
      yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
      yield take(operationFinished("PROOFREADING"));
      expect(yield* getAgglomerateTreeNodePositions()).toEqual([
        [1, 2, 3, 4, 5].map(getPositionForSegmentId),
      ]);
      proofreadingStartedTask.cancel();
    });

    await task.toPromise();
  });
});
