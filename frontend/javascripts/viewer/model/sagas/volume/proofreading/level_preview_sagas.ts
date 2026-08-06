import {
  getAgglomeratesForSegmentsFromTracingstore,
  getMappingLevelPreviewSkeleton,
} from "admin/rest_api";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { call, put } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getActiveUnmappedSegmentId,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  type CommitMappingLevelPreviewAction,
  clearMappingLevelPreviewAction,
  type SetMappingLevelPreviewTargetAction,
  setMappingLevelPreviewSkeletonAction,
  setMappingLevelPreviewStatusAction,
} from "viewer/model/actions/proofread_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setMappingDataAction } from "viewer/model/actions/settings_actions";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { createTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { setAgglomerateMappingLevel } from "viewer/model/sagas/volume/update_actions";
import type { VolumeTracing } from "viewer/store";
import type { OperationContext } from "../../operation_context_saga";
import {
  subscribeToAnnotationMutexInLiveCollab,
  syncWithBackend,
} from "./backend_sync_helper_sagas";
import { buildMappingLevelPreviewSkeleton } from "./mapping_level_preview_helpers";
import { createEditableMapping, ensureHdf5MappingIsEnabled } from "./preparation_sagas";

// See SPIKE-per-agglomerate-mapping-level.md. Two flows live here:
// - handleMappingLevelPreviewChange: debounced read-only fetch of the preview skeleton for the chosen level.
// - handleCommitMappingLevelPreview: commits the chosen level as a single atomic update action.

type PreviewAnchor = {
  segmentId?: number | null;
  segmentPosition?: Vector3 | null;
  mag?: Vector3 | null;
};

// Resolves the anchor supervoxel of the currently selected agglomerate, either as an unmapped id (3D-viewport
// selection) or as a position + mag (data-viewport selection, resolved server-side like split/merge).
function* resolveAnchor(volumeTracing: VolumeTracing): Saga<PreviewAnchor | null> {
  const activeUnmappedSegmentId = yield* select((state) =>
    getActiveUnmappedSegmentId(state, volumeTracing),
  );
  if (activeUnmappedSegmentId != null) {
    return { segmentId: activeUnmappedSegmentId };
  }
  const { activeCellId, tracingId } = volumeTracing;
  if (activeCellId == null || activeCellId === 0) return null;
  const segments = yield* select((state) => getSegmentsForLayer(state, tracingId));
  const anchorPosition = segments.getNullable(activeCellId)?.anchorPosition;
  if (anchorPosition == null) return null;
  const currentMag = yield* select((state) => getCurrentMag(state, tracingId));
  if (currentMag == null) return null;
  return { segmentPosition: V3.floor(anchorPosition), mag: currentMag };
}

export function* handleMappingLevelPreviewChange(
  action: SetMappingLevelPreviewTargetAction,
): Saga<void> {
  const { targetMappingName } = action;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null || volumeTracing.mappingName == null) return;
  const volumeTracingId = volumeTracing.tracingId;

  // The preview requires an editable (locked) mapping. Ensure it exists (this locks the mapping, exactly like the
  // first regular proofreading action would). See the note in the spike doc.
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, volumeTracingId);
  if (!isHdf5MappingEnabled) return;
  if (!volumeTracing.hasEditableMapping) {
    try {
      yield* call(createEditableMapping);
    } catch (e) {
      console.error(e);
      yield* put(setMappingLevelPreviewStatusAction("ERROR"));
      return;
    }
  }

  const anchor = yield* call(resolveAnchor, volumeTracing);
  if (anchor == null) {
    yield* put(setMappingLevelPreviewStatusAction("ERROR"));
    return;
  }

  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const version = yield* select((state) => state.annotation.version);

  try {
    const buffer = yield* call(
      getMappingLevelPreviewSkeleton,
      tracingStoreUrl,
      volumeTracingId,
      anchor,
      targetMappingName,
      version,
    );

    // Guard against stale responses: if the user changed the target while this request was in flight, discard it.
    const currentPreview = yield* select(
      (state) => state.localSegmentationStateByLayer[volumeTracingId]?.mappingLevelPreview,
    );
    if (currentPreview == null || currentPreview.targetMappingName !== targetMappingName) {
      return;
    }

    const parsedTracing = parseProtoTracing(buffer, "skeleton");
    if (!("trees" in parsedTracing)) {
      throw new Error("Preview skeleton response does not contain trees.");
    }
    const skeleton = buildMappingLevelPreviewSkeleton(
      createTreeMapFromTreeArray(parsedTracing.trees),
    );
    yield* put(setMappingLevelPreviewSkeletonAction(skeleton));
  } catch (e) {
    console.error("Could not load mapping-level preview skeleton", e);
    yield* put(setMappingLevelPreviewStatusAction("ERROR"));
  }
}

export function* handleCommitMappingLevelPreview(
  _action: CommitMappingLevelPreviewAction,
  ctx: OperationContext,
): Saga<void> {
  const allowUpdate = yield* select((state) => mayEditAnnotation(state));
  if (!allowUpdate) return;

  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const volumeTracingId = volumeTracing.tracingId;

  const preview = yield* select(
    (state) => state.localSegmentationStateByLayer[volumeTracingId]?.mappingLevelPreview,
  );
  if (preview == null) {
    Toast.warning("No mapping-level preview is active to commit.");
    return;
  }
  const { targetMappingName } = preview;

  // Ensures the editable mapping exists (should already, due to the preview) before committing.
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, volumeTracingId);
  if (!isHdf5MappingEnabled) return;
  if (!volumeTracing.hasEditableMapping) {
    try {
      yield* call(createEditableMapping, ctx);
    } catch (e) {
      console.error(e);
      return;
    }
  }

  const anchor = yield* call(resolveAnchor, volumeTracing);
  if (anchor == null) {
    Toast.warning("Could not determine the selected supervoxel to commit the mapping level.");
    return;
  }

  // One small action; the tracingstore expands it into the equivalent split/merge edges as one atomic version.
  yield* put(
    pushSaveQueueTransaction([
      setAgglomerateMappingLevel(anchor, targetMappingName, volumeTracingId),
    ]),
  );

  const unsubscribeFromAnnotationMutex = yield* call(
    subscribeToAnnotationMutexInLiveCollab,
    "Proofreading Mapping Level",
  );
  try {
    yield* call(syncWithBackend, ctx);

    // Coarse refresh (spike): re-fetch agglomerate ids for all currently-known segments so the 2D rendering reflects
    // the committed change. A finer, incremental refresh (and precise mesh/skeleton sync) is a follow-up.
    const activeMapping = yield* select(
      (state) => state.temporaryConfiguration.activeMappingByLayer[volumeTracingId],
    );
    if (activeMapping?.mapping != null) {
      const segmentIds = new Set<number>();
      for (const id of activeMapping.mapping.keys()) {
        segmentIds.add(Number(id));
      }
      if (segmentIds.size > 0) {
        const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
        const annotationId = yield* select((state) => state.annotation.annotationId);
        const newVersion = yield* select((state) => state.annotation.version);
        const refreshedMapping = yield* call(() =>
          getAgglomeratesForSegmentsFromTracingstore(
            tracingStoreUrl,
            volumeTracingId,
            segmentIds,
            annotationId,
            newVersion,
          ),
        );
        yield* put(setMappingDataAction(volumeTracingId, refreshedMapping, true));
      }
    }

    // The committed level is now reality; tear down the preview.
    yield* put(clearMappingLevelPreviewAction());
    Toast.success(`Committed mapping level "${targetMappingName}" for the selected agglomerate.`);
  } finally {
    if (unsubscribeFromAnnotationMutex) {
      yield* call(unsubscribeFromAnnotationMutex);
    }
  }
}
