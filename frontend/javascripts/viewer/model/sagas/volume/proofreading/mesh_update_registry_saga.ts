import type { Task } from "redux-saga";
import type { CallEffect } from "redux-saga/effects";
import { call, cancel, join, put, type SagaGenerator } from "typed-redux-saga";
import {
  getMeshInfoForSegment,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import { removeMeshAction } from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { spawnEffectUntilCanceled, spawnUntilCanceled } from "../../saga_helpers";
import type { AgglomerateChangeItem } from "./proofreading_types";

// A small module orchestrating background mesh syncing (with potential fallback to a full reload).
type MeshUpdateEffect = SagaGenerator<void, CallEffect<void>>;

// A local registry storing ongoing operations per agglomerate id because new scheduled
// mesh sync operations should stop old ongoing once before starting to not get interleaved
// by an old operation.
const activeMeshUpdateTasksRegistry = new Map<string, Map<bigint, Task>>();

/**
 * Schedules a mesh updating / syncing effect and cancels old running ones.
 */
export function* scheduleMeshUpdate(
  meshUpdateEffect: MeshUpdateEffect,
  layerName: string,
  refreshInfos: AgglomerateChangeItem[],
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
  // Must be a spawn operation due to else this task the thus the caller only terminating once
  // the syncing is done.
  const task = yield* spawnEffectUntilCanceled(
    call(runEffectWithOrphanCleanup, meshUpdateEffect, layerName, refreshInfos),
  );
  for (const id of deduplicatedAgglomerateIds) {
    activeMeshUpdateTasksRegistry.get(layerName)?.set(id, task);
  }

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

// Ensures every oldAgglomerateId is resolved even if effect gets cancelled (e.g. superseded)
// before reaching it - otherwise its mesh could be left orphaned.
function* runEffectWithOrphanCleanup(
  effect: MeshUpdateEffect,
  layerName: string,
  refreshInfos: AgglomerateChangeItem[],
): Saga<void> {
  try {
    yield* effect;
  } finally {
    yield* call(cleanUpOrphanedMeshes, layerName, refreshInfos);
  }
}

function* cleanUpOrphanedMeshes(
  layerName: string,
  refreshInfos: AgglomerateChangeItem[],
): Saga<void> {
  const oldIds = new Set(
    refreshInfos.map((info) => info.oldAgglomerateId).filter((id): id is bigint => id != null),
  );
  const segments = yield* select((state) => getSegmentsForLayer(state, layerName));
  for (const id of oldIds) {
    if (segments.getNullable(id) != null) continue;
    const meshInfo = yield* select((state) => getMeshInfoForSegment(state, null, layerName, id));
    if (meshInfo != null) {
      yield* put(removeMeshAction(layerName, id));
    }
  }
}
