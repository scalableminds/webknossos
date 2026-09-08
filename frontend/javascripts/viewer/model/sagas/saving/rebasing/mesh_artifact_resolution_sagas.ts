import { all, call, put } from "typed-redux-saga";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getSegmentsForLayer,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { removeMeshAction } from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { spawnUntilCanceled, waitUntilNoActiveOperations } from "../../saga_helpers";
import type { AgglomerateChangeItem } from "../../volume/proofreading/proofreading_types";
import { syncAffectedAndLoadMissingMeshes } from "../../volume/proofreading/segment_and_mesh_refresh_sagas";
import type { ApplyingUpdateArtifacts } from "./applying_update_artifacts";

export function* resolveApplyingUpdateArtifacts(
  artifactInfos: ApplyingUpdateArtifacts,
): Saga<void> {
  const activeVolumeTracingId = (yield* select(getVisibleSegmentationLayer))?.tracingId;
  if (!activeVolumeTracingId) {
    return;
  }
  // Spawned detached so that it does not block the rebasing. Removal (for whatever couldn't be
  // spliced locally) and reload both happen inside syncAffectedAndLoadMissingMeshes now, rather
  // than eagerly removing old meshes here - a locally-splice-able merge/split needs the old
  // mesh's scene-graph data to still exist when the splice runs (see local_mesh_change_sagas.ts).
  yield* spawnUntilCanceled(reloadMeshes, artifactInfos.meshesToLoadPerLayer);
}

// Potentially waits until saving is done. Thus, !must be called with spawn!.
function* reloadMeshes(
  meshesToReloadPerLayer: ApplyingUpdateArtifacts["meshesToLoadPerLayer"],
): Saga<void> {
  // First wait in case an operation is running (e.g. proofreading) until it finishes.
  yield call(waitUntilNoActiveOperations);
  const syncAffectedAndLoadMissingMeshesEffects = [];
  for (const [tracingId, reloadEntryByAgglomerateId] of meshesToReloadPerLayer.entries()) {
    const refreshList: AgglomerateChangeItem[] = [];
    const { hasSegmentIndex } = yield* select((state) =>
      getVolumeTracingById(state.annotation, tracingId),
    );
    const segments = yield* select((state) => getSegmentsForLayer(state, tracingId));

    for (const [
      newAgglomerateId,
      { oldAgglomerateIds, displayProps },
    ] of reloadEntryByAgglomerateId) {
      const segment = segments.getNullable(newAgglomerateId);
      // No segment exists for newAgglomerateId anymore - this can happen if, by the time this
      // runs, newAgglomerateId itself was already superseded by something else (e.g. a
      // concurrent local proofreading action independently relabeled it onto a further id).
      if (!(segment && (segment?.anchorPosition || hasSegmentIndex))) {
        for (const oldAgglomerateId of oldAgglomerateIds) {
          yield* put(removeMeshAction(tracingId, oldAgglomerateId));
        }
        continue;
      }
      // If the annotation has a segment index, the seed position for the mesh generation is ignored. In that case we can simply use [0, 0, 0].
      const nodePosition = segment?.anchorPosition ?? [0, 0, 0];
      // Emit one item per contributing old agglomerate id, so detectMergeAndSplitChanges (inside
      // syncAffectedAndLoadMissingMeshes) can recognize merge/split shapes and try to splice them
      // locally instead of always doing a hard reload.
      for (const oldAgglomerateId of oldAgglomerateIds) {
        refreshList.push({
          oldAgglomerateId,
          newAgglomerateId,
          nodePosition,
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
