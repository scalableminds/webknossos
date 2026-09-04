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
import { syncAffectedAndLoadMissingMeshes } from "../../volume/proofreading/segment_and_mesh_refresh_sagas";
import type { ApplyingUpdateArtifacts } from "./applying_update_artifacts";

export function* resolveApplyingUpdateArtifacts(
  artifactInfos: ApplyingUpdateArtifacts,
): Saga<void> {
  const activeVolumeTracingId = (yield* select(getVisibleSegmentationLayer))?.tracingId;
  if (!activeVolumeTracingId) {
    return;
  }
  // The opacities to apply to the reloaded meshes were already gathered while applying the
  // update actions (see meshesToLoadPerLayer), i.e. before the original meshes are removed below.
  yield* call(removeOutdatedMeshes, artifactInfos.meshIdsToRemovePerLayer);
  // The reloading of the meshes is spawned detached so that it does not block the rebasing.
  yield* spawnUntilCanceled(reloadMeshes, artifactInfos.meshesToLoadPerLayer);
}

function* removeOutdatedMeshes(
  meshIdsToRemovePerLayer: ApplyingUpdateArtifacts["meshIdsToRemovePerLayer"],
): Saga<void> {
  // Remove all outdated meshes.
  for (const [tracingId, meshIdsToRemove] of meshIdsToRemovePerLayer.entries()) {
    for (const aggloId of meshIdsToRemove) {
      yield* put(removeMeshAction(tracingId, aggloId));
    }
  }
}

// Potentially waits until saving is done. Thus, !must be called with spawn!.
function* reloadMeshes(
  meshesToReloadPerLayer: ApplyingUpdateArtifacts["meshesToLoadPerLayer"],
): Saga<void> {
  // First wait in case an operation is running (e.g. proofreading) until it finishes.
  yield call(waitUntilNoActiveOperations);
  const syncAffectedAndLoadMissingMeshesEffects = [];
  for (const [tracingId, displayPropsByAgglomerateId] of meshesToReloadPerLayer.entries()) {
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
    syncAffectedAndLoadMissingMeshesEffects.push(
      call(syncAffectedAndLoadMissingMeshes, tracingId, refreshList),
    );
  }
  yield* all(syncAffectedAndLoadMissingMeshesEffects);
}
