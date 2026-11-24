// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { Task } from "@redux-saga/types";
import ErrorHandling from "libs/error_handling";
import { call, put } from "redux-saga/effects";
import {
  mergeSegment1And4,
  mergeSegment5And6,
  splitSegment2And3,
} from "test/sagas/proofreading/proofreading_interaction_update_action_fixtures";
import {
  getAllCurrentlyLoadedMeshIds,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableForTest,
  mockInitialBucketAndAgglomerateData,
} from "test/sagas/proofreading/proofreading_test_utils";
import { cancel, delay, takeEvery } from "typed-redux-saga";
import {
  type FinishedLoadingMeshAction,
  type RemoveMeshAction,
  setCollaborationModeAction,
  updateMeshOpacityAction,
  updateMeshVisibilityAction,
} from "viewer/model/actions/annotation_actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import { startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * End-to-end tests for the mesh refresh that follows applying merges and splits of other users
 * while forwarding/rebasing (performRebasingIfNecessary). Only the public surface is used (the
 * version polling via dispatchEnsureHasNewestVersionAsync and the store), so that these tests
 * run unchanged against different implementations of the rebasing internals.
 *
 * Initial agglomerates (see proofreading_test_utils): 1 = {1, 2, 3}, 4 = {4, 5}, 6 = {6, 7}.
 */

type Batches = UpdateActionWithoutIsolationRequirement[][];
type DisplayProps = { opacity?: number; isVisible?: boolean };

const revertToVersion1 = [
  [{ name: "revertToVersion" as const, value: { sourceVersion: 1 } }],
] as unknown as Batches;

function getMeshDisplayProps(tracingId: string, id: bigint): DisplayProps | undefined {
  const meshInfo =
    Store.getState().localSegmentationStateByLayer[tracingId]?.meshes?.[""]?.[id.toString()];
  if (meshInfo == null) return undefined;
  return { opacity: meshInfo.opacity, isVisible: meshInfo.isVisible };
}

type MeshActionTracker = {
  removedMeshes: Set<bigint>;
  addedMeshes: Set<bigint>;
  stop: () => Saga<void>;
};

function* trackMeshActions(): Saga<MeshActionTracker> {
  const removedMeshes = new Set<bigint>();
  const addedMeshes = new Set<bigint>();
  const tasks: Task<any>[] = [
    (yield* takeEvery("REMOVE_MESH", (action: RemoveMeshAction) => {
      removedMeshes.add(action.segmentId);
    })) as Task<any>,
    (yield* takeEvery("FINISHED_LOADING_MESH", (action: FinishedLoadingMeshAction) => {
      addedMeshes.add(action.segmentId);
    })) as Task<any>,
  ];
  function* stop(): Saga<void> {
    for (const task of tasks) {
      yield cancel(task);
    }
  }
  return { removedMeshes, addedMeshes, stop };
}

// Mesh loads run detached. Wait until exactly the expected meshes are in the scene and none of
// them is still loading. On timeout, the assertions that follow report the difference.
function* waitForMeshes(
  context: WebknossosTestContext,
  tracingId: string,
  expectedIds: bigint[],
): Saga<void> {
  const expected = new Set(expectedIds);
  for (let attempt = 0; attempt < 100; attempt++) {
    const loadedIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
    const isAnyMeshLoading = yield* select((state: WebknossosState) =>
      Object.values(state.localSegmentationStateByLayer[tracingId]?.meshes?.[""] ?? {}).some(
        (meshInfo) => meshInfo.isLoading,
      ),
    );
    if (loadedIds.symmetricDifference(expected).size === 0 && !isAnyMeshLoading) {
      // Give pending FINISHED_LOADING_MESH listeners a chance to run.
      yield* delay(20);
      return;
    }
    yield* delay(20);
  }
}

// Loads the given meshes with the given display props and makes the annotation collaborative.
function* setUp(
  context: WebknossosTestContext,
  tracingId: string,
  meshIds: number[],
  displayPropsById: Record<number, DisplayProps> = {},
): Saga<void> {
  yield call(initializeMappingAndTool, context, tracingId);
  // Collaborative proofreading requires an editable mapping.
  yield makeMappingEditableForTest();
  yield put(setCollaborationModeAction("Concurrent"));
  yield loadAgglomerateMeshes(meshIds);
  for (const [id, { opacity, isVisible }] of Object.entries(displayPropsById)) {
    if (opacity != null) yield put(updateMeshOpacityAction(tracingId, BigInt(id), opacity));
    if (isVisible != null)
      yield put(updateMeshVisibilityAction(tracingId, BigInt(id), isVisible, null));
  }
  expect(getAllCurrentlyLoadedMeshIds(context, tracingId)).toEqual(
    new Set(meshIds.map((id) => BigInt(id))),
  );
}

describe("Mesh refresh after applying actions of other users", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
    vi.mocked(ErrorHandling.notifyWithPrefix).mockClear();
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("merge with source mesh loaded: removes both meshes and reloads the source with its display props", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [1, 4, 6], {
        4: { opacity: 0.3, isVisible: false },
        6: { opacity: 0.8 },
      });
      backendMock.planMultipleVersionInjections(
        Store.getState().annotation.version + 1,
        mergeSegment5And6 as unknown as Batches,
      );
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* waitForMeshes(context, tracingId, [1n, 4n]);
      yield* tracker.stop();

      expect(tracker.removedMeshes).toEqual(new Set([4n, 6n]));
      expect([...tracker.addedMeshes]).toEqual([4n]);
      expect(getMeshDisplayProps(tracingId, 4n)).toEqual({ opacity: 0.3, isVisible: false });
    }).toPromise();
  });

  it("merge with only the target mesh loaded: reloads the source with the target's display props", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [1, 6], { 6: { opacity: 0.6, isVisible: false } });
      backendMock.planMultipleVersionInjections(
        Store.getState().annotation.version + 1,
        mergeSegment5And6 as unknown as Batches,
      );
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* waitForMeshes(context, tracingId, [1n, 4n]);
      yield* tracker.stop();

      expect(tracker.removedMeshes).toEqual(new Set([4n, 6n]));
      expect([...tracker.addedMeshes]).toEqual([4n]);
      expect(getMeshDisplayProps(tracingId, 4n)).toEqual({ opacity: 0.6, isVisible: false });
    }).toPromise();
  });

  it("merge without an affected mesh loaded: does not touch any mesh", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [1]);
      backendMock.planMultipleVersionInjections(
        Store.getState().annotation.version + 1,
        mergeSegment5And6 as unknown as Batches,
      );
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* delay(200);
      yield* tracker.stop();

      expect([...tracker.removedMeshes]).toEqual([]);
      expect([...tracker.addedMeshes]).toEqual([]);
      expect([...getAllCurrentlyLoadedMeshIds(context, tracingId)]).toEqual([1n]);
    }).toPromise();
  });

  it("split with mesh loaded: reloads all resulting agglomerates with the old agglomerate's display props", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [1, 4], {
        1: { opacity: 0.4, isVisible: false },
        4: { opacity: 0.9 },
      });
      // Segment 3 keeps agglomerate 1, segments 1 and 2 become agglomerate 1339.
      backendMock.planMultipleVersionInjections(
        Store.getState().annotation.version + 1,
        splitSegment2And3 as unknown as Batches,
      );
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* waitForMeshes(context, tracingId, [1n, 4n, 1339n]);
      yield* tracker.stop();

      // 1339 is "removed" too because loading a mesh first removes an existing one.
      expect(tracker.removedMeshes).toEqual(new Set([1n, 1339n]));
      expect(tracker.addedMeshes).toEqual(new Set([1n, 1339n]));
      expect(getMeshDisplayProps(tracingId, 1n)).toEqual({ opacity: 0.4, isVisible: false });
      expect(getMeshDisplayProps(tracingId, 1339n)).toEqual({ opacity: 0.4, isVisible: false });
      expect(getMeshDisplayProps(tracingId, 4n)).toEqual({ opacity: 0.9, isVisible: true });
    }).toPromise();
  });

  describe.each([
    ["in consecutive versions", false],
    ["in one version", true],
  ])("chain of two merges (6 into 4, then 4 into 1) %s", (_label, inOneVersion) => {
    it("only reloads the final agglomerate, with the display props of the first merged mesh", async (context: WebknossosTestContext) => {
      const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
      const { tracingId } = Store.getState().annotation.volumes[0];

      await startSaga(function* () {
        yield* setUp(context, tracingId, [4, 6], {
          4: { opacity: 0.3, isVisible: false },
          6: { opacity: 0.8 },
        });
        const batches = [...mergeSegment5And6, ...mergeSegment1And4] as unknown as Batches;
        backendMock.planMultipleVersionInjections(
          Store.getState().annotation.version + 1,
          inOneVersion ? [batches.flat()] : batches,
        );
        const tracker = yield* trackMeshActions();
        yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
        yield* waitForMeshes(context, tracingId, [1n]);
        yield* tracker.stop();

        expect(tracker.removedMeshes).toEqual(new Set([1n, 4n, 6n]));
        // 4 was merged into 1 and must not be reloaded.
        expect([...tracker.addedMeshes]).toEqual([1n]);
        // Mesh 1 was not loaded before, so it inherits the props of the merged mesh 4.
        expect(getMeshDisplayProps(tracingId, 1n)).toEqual({ opacity: 0.3, isVisible: false });
      }).toPromise();
    });
  });

  // All actions of one poll are applied before the scene is updated. So a merge or split must
  // see the reloads that earlier actions of the same poll recorded, not only the scene.
  it("split, then merge of the split-off part into an agglomerate without mesh: shows the merge result", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [1], { 1: { opacity: 0.4 } });
      // Split 1 = {1, 2, 3} into 1 = {3} and 1339 = {1, 2}. Then merge 1339 into 4.
      // Same action sequence as a merge in the proofreading UI (see mergeSegment5And6).
      const mergeAgglomerateValue = {
        actionTracingId: tracingId,
        segmentId1: 4n,
        segmentId2: 2n,
        agglomerateId1: 4n,
        agglomerateId2: 1339n,
      };
      const mergeSplitOffPartInto4 = [
        [
          {
            name: "createSegment" as const,
            value: {
              actionTracingId: tracingId,
              id: 4n,
              anchorPosition: [4, 4, 4],
              additionalCoordinates: undefined,
              name: null,
              color: null,
              groupId: null,
              metadata: [],
              creationTime: 1494695001688,
            },
          },
        ],
        [{ name: "mergeAgglomerate" as const, value: mergeAgglomerateValue }],
        [{ name: "mergeSegmentItems" as const, value: mergeAgglomerateValue }],
      ];
      backendMock.planMultipleVersionInjections(Store.getState().annotation.version + 1, [
        ...(splitSegment2And3 as unknown as Batches),
        ...(mergeSplitOffPartInto4 as unknown as Batches),
      ]);
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* delay(300);
      yield* waitForMeshes(context, tracingId, [1n, 4n]);
      yield* tracker.stop();

      const mapping = Store.getState().temporaryConfiguration.activeMappingByLayer[tracingId]
        ?.mapping as Map<number, number>;
      expect([mapping.get(1), mapping.get(2), mapping.get(3), mapping.get(4)]).toEqual([
        4, 4, 1, 4,
      ]);
      // Segments 1 and 2, whose mesh was shown before, are now part of agglomerate 4. Mesh 4 gets
      // the opacity of mesh 1, which was recorded for the split-off part 1339.
      expect(getAllCurrentlyLoadedMeshIds(context, tracingId)).toEqual(new Set([1n, 4n]));
      expect(getMeshDisplayProps(tracingId, 1n)?.opacity).toBe(0.4);
      expect(getMeshDisplayProps(tracingId, 4n)?.opacity).toBe(0.4);
    }).toPromise();
  });

  it("merge with only the target mesh loaded, then split of the merged agglomerate: shows the part with the target's segments", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    await startSaga(function* () {
      yield* setUp(context, tracingId, [6], { 6: { opacity: 0.6 } });
      // Merge 6 into 4 (4 = {4, 5, 6, 7}). Then split it into 4 = {4} and 1339 = {5, 6, 7}.
      const split4And5 = [
        [
          {
            name: "splitAgglomerate" as const,
            value: {
              actionTracingId: tracingId,
              segmentId1: 4n,
              segmentId2: 5n,
              agglomerateId: 4n,
            },
          },
        ],
        [
          {
            name: "createSegment" as const,
            value: {
              actionTracingId: tracingId,
              id: 1339n,
              anchorPosition: [5, 5, 5],
              additionalCoordinates: undefined,
              name: null,
              color: null,
              groupId: null,
              metadata: [],
              creationTime: 1494695001688,
            },
          },
        ],
      ];
      backendMock.planMultipleVersionInjections(Store.getState().annotation.version + 1, [
        ...(mergeSegment5And6 as unknown as Batches),
        ...(split4And5 as unknown as Batches),
      ]);
      const tracker = yield* trackMeshActions();
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield* delay(300);
      const mapping = Store.getState().temporaryConfiguration.activeMappingByLayer[tracingId]
        ?.mapping as Map<number, number>;
      const agglomerateOfSegment6 = BigInt(mapping.get(6) ?? -1);
      yield* waitForMeshes(context, tracingId, [4n, agglomerateOfSegment6]);
      yield* tracker.stop();

      expect(agglomerateOfSegment6).toBe(1339n);
      // Segment 6, whose mesh was shown before, is now part of agglomerate 1339. Both parts of the
      // split get the opacity of mesh 6, which was recorded for the merged mesh 4.
      expect(getAllCurrentlyLoadedMeshIds(context, tracingId)).toEqual(new Set([4n, 1339n]));
      expect(getMeshDisplayProps(tracingId, 4n)?.opacity).toBe(0.6);
      expect(getMeshDisplayProps(tracingId, 1339n)?.opacity).toBe(0.6);
    }).toPromise();
  });

  it("failed forwarding (foreign revert after a foreign merge): does not refresh any mesh", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    let tracker: MeshActionTracker | undefined;
    await startSaga(function* () {
      yield* setUp(context, tracingId, [4, 6]);
      backendMock.planMultipleVersionInjections(Store.getState().annotation.version + 1, [
        ...(mergeSegment5And6 as unknown as Batches),
        ...revertToVersion1,
      ]);
      tracker = yield* trackMeshActions();
      // Not yielded on purpose: if rebasing fails, the promise is never resolved.
      dispatchEnsureHasNewestVersionAsync(Store.dispatch);
      for (let attempt = 0; attempt < 250; attempt++) {
        if (vi.mocked(ErrorHandling.notifyWithPrefix).mock.calls.length > 0) break;
        yield* delay(20);
      }
      // Give a (wrongly) spawned mesh reload time to happen.
      yield* delay(200);
      yield* tracker.stop();
    }).toPromise();

    expect(vi.mocked(ErrorHandling.notifyWithPrefix)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ErrorHandling.notifyWithPrefix).mock.calls[0][2]).toMatchObject({
      reason: "Annotation was reverted by another user",
    });
    expect([...tracker!.removedMeshes]).toEqual([]);
    expect([...tracker!.addedMeshes]).toEqual([]);
    expect(getAllCurrentlyLoadedMeshIds(context, tracingId)).toEqual(new Set([4n, 6n]));
  });
});
