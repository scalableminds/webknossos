import { sleep } from "libs/utils";
import { runSaga } from "redux-saga";
import { call } from "viewer/model/sagas/effect_generators";
import {
  type ScheduledMeshChange,
  scheduleLocalMeshChangesRespectingDependencies,
} from "viewer/model/sagas/volume/proofreading/parked_pooled_local_mesh_change_scheduler";
import type { AgglomerateChangeItem } from "viewer/model/sagas/volume/proofreading/proofreading_types";
import { describe, expect, it, vi } from "vitest";

// segment_and_mesh_refresh_sagas.ts (imported transitively via
// parked_pooled_local_mesh_change_scheduler.ts) transitively imports precomputed_mesh_saga.ts,
// which instantiates a three-mesh-bvh web worker at module load time - mock it away like
// apiHelpers.ts does for the full proofreading test suite, since this file only exercises the
// plain, scene/network-independent scheduling logic and never touches BVH computation.
vi.mock("libs/compute_bvh_async", () => ({
  computeBvhAsync: vi.fn().mockResolvedValue(undefined),
}));

// Minimal fake AgglomerateChangeItem, only used so failed changes can be told apart in the
// returned reload list - the scheduler itself never inspects an item's contents.
function fakeItem(newAgglomerateId: bigint): AgglomerateChangeItem {
  return { newAgglomerateId, nodePosition: [0, 0, 0] };
}

describe("scheduleLocalMeshChangesRespectingDependencies", () => {
  it("runs independent changes concurrently", async () => {
    const order: string[] = [];
    const changes: ScheduledMeshChange[] = [
      {
        producedIds: [1n],
        consumedIds: [10n],
        items: [fakeItem(1n)],
        run: function* () {
          order.push("A-start");
          yield* call(sleep, 50);
          order.push("A-end");
          return true;
        },
      },
      {
        producedIds: [2n],
        consumedIds: [20n],
        items: [fakeItem(2n)],
        run: function* () {
          order.push("B-start");
          yield* call(sleep, 10);
          order.push("B-end");
          return true;
        },
      },
    ];

    await runSaga({}, scheduleLocalMeshChangesRespectingDependencies, changes).toPromise();

    // Both changes start before either finishes - i.e. they ran in the same wave, not one after
    // another. B (the shorter sleep) also finishes before A, proving they're truly concurrent
    // rather than merely both scheduled up front and then awaited in sequence.
    expect(order).toEqual(["A-start", "B-start", "B-end", "A-end"]);
  });

  it("defers a change until the change producing the id it consumes has fully completed", async () => {
    const order: string[] = [];
    // B and C merge into X (produces X, consumes B and C), then X immediately merges into Y
    // (produces Y, consumes X) - e.g. from incorporating a sequence of foreign update actions into
    // the same batch. X must be fully spliced together before the X->Y change is allowed to touch
    // it, even though both changes are handed to the scheduler at once.
    const mergeIntoX: ScheduledMeshChange = {
      producedIds: [10n], // X
      consumedIds: [1n, 2n], // B, C
      items: [fakeItem(10n)],
      run: function* () {
        order.push("mergeIntoX-start");
        yield* call(sleep, 50);
        order.push("mergeIntoX-end");
        return true;
      },
    };
    const mergeXIntoY: ScheduledMeshChange = {
      producedIds: [20n], // Y
      consumedIds: [10n], // X
      items: [fakeItem(20n)],
      run: function* () {
        order.push("mergeXIntoY-start");
        yield* call(sleep, 0);
        return true;
      },
    };

    await runSaga(
      {},
      scheduleLocalMeshChangesRespectingDependencies,
      [mergeXIntoY, mergeIntoX], // order in the input array shouldn't matter
    ).toPromise();

    expect(order).toEqual(["mergeIntoX-start", "mergeIntoX-end", "mergeXIntoY-start"]);
  });

  it("does not block a change on an id it both produces and consumes itself", async () => {
    const order: string[] = [];
    // A min-cut-style merge that keeps one of its own old ids as the resulting id (old 1n, 2n ->
    // new 1n) - 1n is both produced and consumed by the very same change, which must not count as
    // a dependency on itself.
    const selfKeepingMerge: ScheduledMeshChange = {
      producedIds: [1n],
      consumedIds: [1n, 2n],
      items: [fakeItem(1n)],
      run: function* () {
        order.push("ran");
        yield* call(sleep, 0);
        return true;
      },
    };

    await runSaga({}, scheduleLocalMeshChangesRespectingDependencies, [
      selfKeepingMerge,
    ]).toPromise();

    expect(order).toEqual(["ran"]);
  });

  it("collects the items of every change that couldn't be handled locally", async () => {
    const succeeding: ScheduledMeshChange = {
      producedIds: [1n],
      consumedIds: [],
      items: [fakeItem(1n)],
      run: function* () {
        yield* call(sleep, 0);
        return true;
      },
    };
    const failing: ScheduledMeshChange = {
      producedIds: [2n],
      consumedIds: [],
      items: [fakeItem(2n)],
      run: function* () {
        yield* call(sleep, 0);
        return false;
      },
    };

    const itemsToReload = await runSaga({}, scheduleLocalMeshChangesRespectingDependencies, [
      succeeding,
      failing,
    ]).toPromise();

    expect(itemsToReload).toEqual([fakeItem(2n)]);
  });

  it("falls back to running everything without further ordering rather than hanging on a cycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const order: string[] = [];
    // A malformed pair that each wait on the other to produce their id first - shouldn't happen
    // with well-formed proofreading data, but must not deadlock the scheduler if it somehow does.
    const changes: ScheduledMeshChange[] = [
      {
        producedIds: [1n],
        consumedIds: [2n],
        items: [],
        run: function* () {
          order.push("first");
          yield* call(sleep, 0);
          return true;
        },
      },
      {
        producedIds: [2n],
        consumedIds: [1n],
        items: [],
        run: function* () {
          order.push("second");
          yield* call(sleep, 0);
          return true;
        },
      },
    ];

    await runSaga({}, scheduleLocalMeshChangesRespectingDependencies, changes).toPromise();

    expect(order.sort()).toEqual(["first", "second"]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
