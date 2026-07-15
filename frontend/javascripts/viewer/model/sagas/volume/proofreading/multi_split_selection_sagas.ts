import Toast from "libs/toast";
import messages from "messages";
import { put } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getActiveSegmentationTracing } from "viewer/model/accessors/volumetracing_accessor";
import type { FinishedLoadingMeshAction } from "viewer/model/actions/annotation_actions";
import {
  resetMultiCutToolPartitionsAction,
  setMultiCutAgglomerateIdAction,
} from "viewer/model/actions/proofread_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { MinCutPartitions } from "viewer/store";

type MultiCutSelectionResolution =
  | { type: "single"; agglomerateId: number }
  | { type: "scattered" }
  | { type: "unloaded" };

// Derives, purely from the currently loaded mesh data (no backend lookup), which agglomerate the
// multi-split partition selection currently belongs to:
// - "single": the selected supervoxels that are loaded all belong to one agglomerate (its id).
// - "scattered": the selected supervoxels span multiple agglomerates (invalid for a min-cut split).
// - "unloaded": none of the selected supervoxels are present in a loaded mesh yet.
export function resolveMultiCutSelectionFromMeshData(
  layerName: string,
  additionalCoordinates: AdditionalCoordinate[] | null,
  minCutPartitions: MinCutPartitions,
): MultiCutSelectionResolution {
  const { segmentMeshController } = getSceneController();
  const { agglomerateIds } = segmentMeshController.getAgglomerateIdsForUnmappedSegmentIds(
    [...minCutPartitions[1], ...minCutPartitions[2]],
    layerName,
    additionalCoordinates,
  );
  if (agglomerateIds.size > 1) {
    return { type: "scattered" };
  }
  if (agglomerateIds.size === 1) {
    return { type: "single", agglomerateId: [...agglomerateIds][0] };
  }
  return { type: "unloaded" };
}

// After a (re)loaded mesh finishes loading, reconcile the multi-split selection with the current
// mesh data. This matters in live-collab: a foreign proofreading edit reloads the mesh the user is
// splitting, potentially under a new agglomerate id (merge/split). We keep the selection's
// agglomerate id in sync while the selection stays within one agglomerate, and clear it (with a
// warning) if the foreign edit scattered the selection across multiple agglomerates, which cannot
// be split. The agglomerate ids are derived purely from the loaded mesh data (no backend lookup).
// Note: this only manages the agglomerate-id bookkeeping. The visual partition highlight is
// re-applied independently in SegmentMeshController.addMeshFromGeometry as each mesh chunk arrives.
export function* syncOrClearMultiCutSelectionAfterMeshReload(
  action: FinishedLoadingMeshAction,
): Saga<void> {
  const isMultiSplitActive = yield* select((state) => state.userConfiguration.isMultiSplitActive);
  if (!isMultiSplitActive) {
    return;
  }
  const volumeTracing = yield* select(getActiveSegmentationTracing);
  if (volumeTracing == null) {
    return;
  }
  const layerName = volumeTracing.tracingId;
  // Only react to meshes of the active segmentation layer.
  if (action.layerName !== layerName) {
    return;
  }
  const minCutPartitions = yield* select(
    (state) => state.localSegmentationStateByLayer[layerName]?.minCutPartitions,
  );
  if (minCutPartitions == null || minCutPartitions.agglomerateId == null) {
    return;
  }
  if (minCutPartitions[1].length + minCutPartitions[2].length === 0) {
    return;
  }
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const resolution = resolveMultiCutSelectionFromMeshData(
    layerName,
    additionalCoordinates,
    minCutPartitions,
  );

  if (resolution.type === "scattered") {
    // A foreign edit scattered the selection across multiple agglomerates. A min-cut can only split
    // a single agglomerate, so the selection is no longer valid. Clear it and inform the user.
    yield* put(resetMultiCutToolPartitionsAction());
    Toast.warning(messages["proofreading.multi_cut.selection_invalidated_by_other_user"]);
  } else if (
    resolution.type === "single" &&
    resolution.agglomerateId !== minCutPartitions.agglomerateId
  ) {
    // The mesh was reloaded under a new agglomerate id (e.g. due to a foreign merge/split). Keep
    // the selection's agglomerate id in sync so further supervoxel toggles are not rejected.
    yield* put(setMultiCutAgglomerateIdAction(resolution.agglomerateId));
  }
  // resolution.type === "unloaded" -> the relevant meshes are not loaded yet; nothing to do.
}
