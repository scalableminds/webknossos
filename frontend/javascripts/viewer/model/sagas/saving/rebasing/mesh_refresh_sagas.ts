import { all, call, put } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getSegmentsForLayer,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { removeMeshAction } from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { spawnUntilCanceled, waitUntilNoActiveOperations } from "../../saga_helpers";
import { refreshAffectedMeshes } from "../../volume/proofreading/segment_and_mesh_refresh_sagas";
import type { MeshRefreshCollector } from "./mesh_refresh_collector";

// Removes the outdated meshes and reloads the new ones that were collected while applying the
// update actions of other users.
export function* applyMeshRefreshes(meshRefreshes: MeshRefreshCollector): Saga<void> {
  const activeVolumeTracingId = (yield* select(getVisibleSegmentationLayer))?.tracingId;
  if (!activeVolumeTracingId) {
    return;
  }
  yield* call(removeOutdatedMeshes, meshRefreshes.meshIdsToRemovePerLayer);
  // The reloading of the meshes is spawned detached so that it does not block the rebasing.
  yield* spawnUntilCanceled(reloadMeshes, meshRefreshes.displayPropsOfMeshesToLoadPerLayer);
}

function* removeOutdatedMeshes(
  meshIdsToRemovePerLayer: MeshRefreshCollector["meshIdsToRemovePerLayer"],
): Saga<void> {
  for (const [tracingId, meshIdsToRemove] of meshIdsToRemovePerLayer.entries()) {
    for (const aggloId of meshIdsToRemove) {
      yield* put(removeMeshAction(tracingId, aggloId));
    }
  }
}

// Potentially waits until saving is done. Thus, !must be called with spawn!.
function* reloadMeshes(
  displayPropsOfMeshesToLoadPerLayer: MeshRefreshCollector["displayPropsOfMeshesToLoadPerLayer"],
): Saga<void> {
  // First wait in case an operation is running (e.g. proofreading) until it finishes.
  yield call(waitUntilNoActiveOperations);
  const refreshAffectedMeshesEffects = [];
  for (const [
    tracingId,
    displayPropsByAgglomerateId,
  ] of displayPropsOfMeshesToLoadPerLayer.entries()) {
    const refreshList: Array<{
      newAgglomerateId: bigint;
      nodePosition: Vector3;
      opacity?: number;
      isVisible?: boolean;
    }> = [];
    const { hasSegmentIndex } = yield* select((state) =>
      getVolumeTracingById(state.annotation, tracingId),
    );
    const segments = yield* select((state) => getSegmentsForLayer(state, tracingId));

    for (const [agglomerateId, displayProps] of displayPropsByAgglomerateId) {
      const segment = segments.getNullable(agglomerateId);
      // Only load meshes for segments still present.
      if (segment && (segment?.anchorPosition || hasSegmentIndex)) {
        refreshList.push({
          newAgglomerateId: agglomerateId,
          // If the annotation has a segment index, the seed position for the mesh generation is ignored. In that case we can simply use [0, 0, 0].
          nodePosition: segment?.anchorPosition ?? [0, 0, 0],
          opacity: displayProps.opacity,
          isVisible: displayProps.isVisible,
        });
      }
    }
    refreshAffectedMeshesEffects.push(call(refreshAffectedMeshes, tracingId, refreshList));
  }
  yield* all(refreshAffectedMeshesEffects);
}
