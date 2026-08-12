// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { MappingStatusEnum } from "viewer/constants";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { splitAgglomeratesInMapping } from "viewer/model/sagas/volume/proofreading/local_mapping_update_sagas";
import { type ActiveMappingInfo, startSaga } from "viewer/store";
import { Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Focused unit tests for `splitAgglomeratesInMapping`.
 *
 * Ensures that `splitAgglomeratesInMapping` queries the backend using segment ids, not agglomerate ids.
 * Prior to the fix, the code queried by agglomerate id, which always returned nothing because
 * agglomerate ids are not segment ids.
 *
 * To make this guarantee explicit, segment ids (1..4) and agglomerate ids (100/200/300) are kept in
 * disjoint value ranges — so no segment id can accidentally equal an agglomerate id, and a query
 * that mistakenly uses the agglomerate id will reliably fail.
 *
 * This is a regression test for the bug explained here: https://github.com/scalableminds/webknossos/issues/9559#issuecomment-4739369932
 */

describe("splitAgglomeratesInMapping", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function buildActiveMapping(mapping: Map<bigint, bigint>): ActiveMappingInfo {
    return {
      mappingName: "disjoint-test-mapping",
      mapping,
      mappingColors: null,
      hideUnmappedIds: false,
      mappingStatus: MappingStatusEnum.ENABLED,
      mappingType: "HDF5",
    };
  }

  function runSplit(
    context: WebknossosTestContext,
    activeMapping: ActiveMappingInfo,
    segmentIdToOldAgglomerateId: Map<bigint, bigint>,
    addAdditionalSegmentsToMapping: boolean,
    // The full mapping the (mocked) tracingstore returns after the split.
    mappingAfterSplit: Array<[bigint, bigint]>,
  ) {
    vi.mocked(context.mocks.getCurrentMappingEntriesFromServer).mockReturnValue(mappingAfterSplit);
    const { tracingId } = Store.getState().annotation.volumes[0];
    const version = Store.getState().annotation.version;
    return startSaga(function* () {
      return yield* splitAgglomeratesInMapping(
        activeMapping,
        segmentIdToOldAgglomerateId,
        tracingId,
        version,
        false,
        addAdditionalSegmentsToMapping,
      );
    }).toPromise();
  }

  describe.each([
    false,
    true,
  ])("[addAdditionalSegmentsToMapping=%s] Should (not) include newly additional requested mapping info in split mapping", (addAdditionalSegmentsToMapping) => {
    it("discovers the split-off agglomerate of a not-locally-mapped segment without polluting the sparse mapping", async (context: WebknossosTestContext) => {
      // Agglomerate 100 = {segment 1, segment 2}, agglomerate 200 = {segment 3, segment 4}.
      // The local store mapping does NOT contain segment 2 (only its mesh is loaded), mirroring a
      // foreign split that is forwarded during live collaboration.
      const activeMapping = buildActiveMapping(
        new Map([
          [1n, 100n],
          [3n, 200n],
          [4n, 200n],
        ]),
      );
      // Segment info extracted from the foreign update action: Agglomerate 100 = {segment 1, segment 2} was split.
      const segmentIdToOldAgglomerateId = new Map([
        [1n, 100n],
        [2n, 100n],
      ]);

      // The split keeps segment 1 on agglomerate 100 and moves segment 2 to the new agglomerate 300.
      const mappingAfterSplit: [bigint, bigint][] = [
        [1n, 100n],
        [2n, 300n],
        [3n, 200n],
        [4n, 200n],
      ];

      const result = await runSplit(
        context,
        activeMapping,
        segmentIdToOldAgglomerateId,
        addAdditionalSegmentsToMapping,
        mappingAfterSplit,
      );

      expect(result).toBeDefined();
      // The new agglomerate 300 is discovered even though segment 2 is not in the local mapping.
      expect(result?.newAgglomerateIds).toEqual(new Set([100n, 300n]));
      expect(result?.oldAgglomerateIds).toEqual(new Set([100n]));
      // Both the retained and the split-off agglomerate inherit from the original agglomerate 100.
      expect(result?.newToOldAgglomerateIds).toEqual(
        new Map([
          [100n, 100n],
          [300n, 100n],
        ]),
      );
      // If addAdditionalSegmentsToMapping = true
      // - Segment 2 stays out of the (sparse) mapping, because it was not present locally.
      // - Else it is present in the mapping.
      const maybeAdditionalEntry: [bigint, bigint][] = addAdditionalSegmentsToMapping
        ? [[2n, 300n]]
        : [];
      expect(result?.mappingWithSplitApplied).toEqual(
        new Map([[1n, 100n], [3n, 200n], [4n, 200n], ...maybeAdditionalEntry]),
      );
    });
  });

  it("re-maps the local segments of every involved agglomerate when multiple agglomerates are split in one batch", async (context: WebknossosTestContext) => {
    // Agglomerate 100 = {1, 2}, agglomerate 200 = {3, 4}. Both are split in the same batch:
    // 100 -> {1 keeps 100} + {2 -> 300}; 200 -> {3 keeps 200} + {4 -> 400}.
    const segmentIdToOldAgglomerateId = new Map([
      [1n, 100n],
      [2n, 100n],
      [3n, 200n],
      [4n, 200n],
    ]);
    const activeMapping = buildActiveMapping(segmentIdToOldAgglomerateId);

    const result = await runSplit(context, activeMapping, segmentIdToOldAgglomerateId, false, [
      [1n, 100n],
      [2n, 300n],
      [3n, 200n],
      [4n, 400n],
    ]);

    // Both old agglomerates are scheduled for refresh and both split-off agglomerates discovered.
    expect(result?.oldAgglomerateIds).toEqual(new Set([100n, 200n]));
    expect(result?.newAgglomerateIds).toEqual(new Set([100n, 200n, 300n, 400n]));
    expect(result?.newToOldAgglomerateIds).toEqual(
      new Map([
        [100n, 100n],
        [300n, 100n],
        [200n, 200n],
        [400n, 200n],
      ]),
    );
    // The interior segments of both agglomerates are re-mapped (they were present locally).
    expect(result?.mappingWithSplitApplied).toEqual(
      new Map([
        [1n, 100n],
        [2n, 300n],
        [3n, 200n],
        [4n, 400n],
      ]),
    );
  });
});
