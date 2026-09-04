// PARKED, NOT WIRED IN. This file is not imported by any live saga - it exists purely so a
// dependency-aware, task-pool-parallelized alternative to
// segment_and_mesh_refresh_sagas.ts's syncAffectedAndLoadMissingMeshes is easy to recover and
// compare against the current sequential (one merge/split group after another) implementation.
//
// Context: syncAffectedAndLoadMissingMeshes tries every merge-shaped group's local splice, then
// every split-shaped group's local split, one after another via plain `for` loops. That's simple
// but means a slow local attempt (e.g. waitForMeshFullyLoaded, or a delta-chunk network fetch)
// blocks every other group behind it. This file replaces that with
// scheduleLocalMeshChangesRespectingDependencies, which runs every group with as much parallelism
// as is safe: independent groups run concurrently via a task pool, while groups with a genuine
// same-batch dependency (e.g. "B and C merge into X" followed, in the same batch, by "X
// immediately merges into Y" - which can happen when incorporating a sequence of foreign update
// actions) are scheduled in dependency-respecting waves instead of racing each other.
//
// This was deliberately parked rather than merged: the base local merge/split feature is already
// substantial, and adding a dependency-tree scheduler on top was judged to be more complexity than
// the parallelism is currently worth. Revisit in code review - if the sequential version turns out
// to be a real bottleneck in practice, swap syncAffectedAndLoadMissingMeshesWithPooledLocalChanges
// in for syncAffectedAndLoadMissingMeshes (see its call site in
// syncAffectedAndMaybeLoadMissingMeshes).
//
// Covered by test/sagas/proofreading/parked_pooled_local_mesh_change_scheduler.spec.ts, which is
// kept running as part of the normal test suite so this doesn't silently bit-rot while parked.

import processTaskWithPool from "libs/async/task_pool";
import { call } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
import Constants from "viewer/constants";
import type { Saga } from "viewer/model/sagas/effect_generators";
import {
  detectMergeAndSplitChanges,
  tryLocalMeshMerge,
  trySplitMeshLocally,
} from "./local_mesh_change_sagas";
import type { AgglomerateChangeItem } from "./proofreading_types";
import {
  getMeshDisplayPropsByOldAgglomerateId,
  reloadMeshes,
} from "./segment_and_mesh_refresh_sagas";

// One local merge or split attempt, generalized so both shapes can be scheduled by the dependency-
// aware runner below: producedIds are the id(s) the operation results in (one for a merge, several
// for a split), consumedIds are the id(s) whose already-loaded mesh it needs to read (several old
// ids for a merge, one for a split).
export type ScheduledMeshChange = {
  producedIds: bigint[];
  consumedIds: bigint[];
  items: AgglomerateChangeItem[];
  run: () => Saga<boolean>;
};

// Runs every scheduled merge/split attempt with as much parallelism as is safe. A single
// changeInfoItems batch can contain *chained* changes - e.g. "B and C merge into X" together with,
// from incorporating a sequence of foreign update actions into the same batch, "X immediately
// merges into Y" - where one change's consumedIds overlap another change's producedIds. Running
// those two at the same time could have one task read or move X's mesh while the other is still in
// the middle of producing it (moveMeshesToNewSegmentId reparents/removes scene-graph entries, so
// this isn't just a stale read - it's a real mutation race). So changes run in dependency-
// respecting "waves": every change whose consumed ids aren't produced by any not-yet-run change in
// this batch runs together via a task pool (real parallelism among unrelated changes), then the
// next wave, and so on. In the overwhelmingly common case - no id produced by one change in the
// batch is needed by another - every change is ready in the first wave, i.e. everything still runs
// in parallel.
export function* scheduleLocalMeshChangesRespectingDependencies(
  changes: ScheduledMeshChange[],
): Saga<AgglomerateChangeItem[]> {
  const itemsToReload: AgglomerateChangeItem[] = [];
  let remaining = changes;

  while (remaining.length > 0) {
    const pendingProducedIds = new Set(remaining.flatMap((change) => change.producedIds));
    const ready: ScheduledMeshChange[] = [];
    const blocked: ScheduledMeshChange[] = [];
    for (const change of remaining) {
      // A change's own produced ids don't block it - relevant for e.g. a merge that keeps one of
      // its old ids as the resulting id (old B, C -> new B), which "produces" an id it also
      // "consumes".
      const isBlockedOnAnotherChange = change.consumedIds.some(
        (id) => pendingProducedIds.has(id) && !change.producedIds.includes(id),
      );
      (isBlockedOnAnotherChange ? blocked : ready).push(change);
    }

    // A genuine cycle can't happen with well-formed proofreading data (an id can't simultaneously
    // be what two different pending changes are each waiting on the other to produce first), but
    // don't hang forever if it somehow does - fall back to running whatever's left without further
    // ordering rather than looping forever.
    const wave = ready.length > 0 ? ready : remaining;
    if (ready.length === 0) {
      console.warn(
        "scheduleLocalMeshChangesRespectingDependencies: could not find a safe execution order for " +
          `${remaining.length} pending mesh change(s), running them without further ordering.`,
      );
    }

    const tasks = wave.map(
      (change) =>
        function* (): Saga<void> {
          const handledLocally = yield* call(change.run);
          if (!handledLocally) itemsToReload.push(...change.items);
        },
    );
    yield* call(processTaskWithPool, tasks, Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);

    remaining = ready.length > 0 ? blocked : [];
  }

  return itemsToReload;
}

// Drop-in alternative to syncAffectedAndLoadMissingMeshes (segment_and_mesh_refresh_sagas.ts) that
// schedules local merge/split attempts via scheduleLocalMeshChangesRespectingDependencies instead
// of two sequential `for` loops. See the module docs above for why this isn't currently wired in.
export function* syncAffectedAndLoadMissingMeshesWithPooledLocalChanges(
  layerName: string,
  changeInfoItems: AgglomerateChangeItem[],
): Saga<void> {
  const additionalCoordinates: AdditionalCoordinate[] | undefined = undefined;

  const oldAgglomerateIds = changeInfoItems
    .map((item) => item.oldAgglomerateId)
    .filter((id) => id != null);
  const displayPropsByOldAgglomerateId = yield* call(
    getMeshDisplayPropsByOldAgglomerateId,
    layerName,
    oldAgglomerateIds,
    additionalCoordinates,
  );

  const { mergeGroups, splitGroups, remainingItems } = detectMergeAndSplitChanges(changeInfoItems);

  const localChanges: ScheduledMeshChange[] = [
    ...mergeGroups.map(
      ({ newAgglomerateId, oldIds, items }): ScheduledMeshChange => ({
        producedIds: [newAgglomerateId],
        consumedIds: oldIds,
        items,
        run: function* (): Saga<boolean> {
          return yield* call(
            tryLocalMeshMerge,
            layerName,
            oldIds,
            newAgglomerateId,
            additionalCoordinates,
          );
        },
      }),
    ),
    ...splitGroups.map(
      ({ oldAgglomerateId, newIds, items }): ScheduledMeshChange => ({
        producedIds: newIds,
        consumedIds: [oldAgglomerateId],
        items,
        run: function* (): Saga<boolean> {
          return yield* call(
            trySplitMeshLocally,
            layerName,
            oldAgglomerateId,
            newIds,
            additionalCoordinates,
          );
        },
      }),
    ),
  ];
  const failedLocalChangeItems = yield* call(
    scheduleLocalMeshChangesRespectingDependencies,
    localChanges,
  );

  const itemsToReload = [...remainingItems, ...failedLocalChangeItems];
  if (itemsToReload.length === 0) return;

  yield* call(
    reloadMeshes,
    layerName,
    itemsToReload,
    displayPropsByOldAgglomerateId,
    additionalCoordinates,
  );
}
