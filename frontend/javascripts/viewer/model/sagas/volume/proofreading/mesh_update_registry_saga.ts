import type { Task } from "redux-saga";
import type { CallEffect } from "redux-saga/effects";
import { cancel, join, type SagaGenerator } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { spawnEffectUntilCanceled, spawnUntilCanceled } from "../../saga_helpers";

// The shape shared by every proofreading mesh-refresh entry point (syncAffectedAndMaybeLoadMissingMeshes /
// syncAffectedAndLoadMissingMeshes), which is what this registry schedules. Kept non-generic (rather than
// parametrized over arbitrary saga functions) since this module is purpose-built for that one
// use case, and a generic signature confuses typed-redux-saga's `call`/`fork` overload
// resolution.
type MeshRefreshItem = {
  oldAgglomerateId?: bigint;
  newAgglomerateId: bigint;
  nodePosition: Vector3;
  opacity?: number;
  isVisible?: boolean;
};
type MeshUpdateEffect = SagaGenerator<void, CallEffect<void>>;

// Keyed by agglomerate id (both ids being retired and ids being produced by a proofreading
// mesh-refresh feed into the same map), so that starting a new mesh update cancels only
// already-running mesh update(s) that touch an overlapping agglomerate id - unrelated concurrent
// mesh work (different agglomerates) keeps running undisturbed. This mirrors the keyed
// cancel-then-fork pattern in mip_saga.ts, but keyed by (possibly several) agglomerate ids per
// task rather than a single bbox/layer key.
// indexed by layer name & agglomerate id.
const activeMeshUpdateTasksRegistry = new Map<string, Map<bigint, Task>>();

/**
 * Runs `sagaFn(...args)` as a detached, cancellable task registered under every id in
 * `agglomerateIds`. If a mesh update task is already registered under any of those ids (from a
 * still-running previous proofreading action affecting an overlapping agglomerate), that task is
 * cancelled first - the new operation supersedes it.
 *
 * Replaces the fire-and-forget `spawnUntilCanceled` calls that used to kick off proofreading mesh
 * refresh work (see segment_and_mesh_refresh_sagas.ts / tree_proofreading_sagas.ts /
 * proofread_action_handler_sagas.ts), whose only cancellation point was a full saga-root restart.
 */
export function* scheduleMeshUpdate(
  meshUpdateEffect: MeshUpdateEffect,
  layerName: string,
  refreshInfos: MeshRefreshItem[],
): Saga<void> {
  const deduplicatedAgglomerateIds = refreshInfos
    .flatMap((info) =>
      info.oldAgglomerateId != null
        ? [info.oldAgglomerateId, info.newAgglomerateId]
        : [info.newAgglomerateId],
    )
    .filter((id): id is bigint => id != null);

  const activeUpdatesOfLayer = activeMeshUpdateTasksRegistry.get(layerName);
  if (activeUpdatesOfLayer) {
    const tasksToCancel = new Set<Task>();
    for (const id of deduplicatedAgglomerateIds) {
      const existingTask = activeUpdatesOfLayer.get(id);
      if (existingTask != null) tasksToCancel.add(existingTask);
    }
    if (tasksToCancel.size > 0) {
      yield* cancel([...tasksToCancel]);
    }
  } else {
    activeMeshUpdateTasksRegistry.set(layerName, new Map());
  }
  // spawn (not fork): this task must be detached from the calling saga's lifecycle - e.g. the
  // proofreading handler that triggered it releases its operation-context slot and mutex well
  // before the mesh refresh is done, and a fork would keep the caller (and thus, transitively,
  // takeEveryInOperationContext's dispatcher) blocked until this task settles, serializing
  // otherwise-independent proofreading actions on the mesh refresh itself.
  // TODO: spawn can hurt us. Maybe instead us a dispatch action with a take listener or so.
  // but it is tracked in the map. as long as we properly clean this up, things should be fine.
  const task = yield* spawnEffectUntilCanceled(meshUpdateEffect);
  for (const id of deduplicatedAgglomerateIds) {
    activeMeshUpdateTasksRegistry.get(layerName)?.set(id, task);
  }

  // Once this task settles (success, error, or cancellation by a future call here), drop its
  // registrations - but only if nothing newer has already replaced them - so the map doesn't grow
  // unboundedly over a long proofreading session and a future operation on these ids doesn't try
  // to cancel an already-finished task.
  yield* spawnUntilCanceled(function* cleanupOnceSettled(): Saga<void> {
    try {
      yield* join(task);
    } finally {
      for (const id of deduplicatedAgglomerateIds) {
        if (activeMeshUpdateTasksRegistry.get(layerName)?.get(id) === task) {
          activeMeshUpdateTasksRegistry.get(layerName)?.delete(id);
        }
      }
    }
  });
}
