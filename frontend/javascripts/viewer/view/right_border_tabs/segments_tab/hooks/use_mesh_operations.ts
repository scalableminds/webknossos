import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { EMPTY_OBJECT } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getMeshesForCurrentAdditionalCoordinates } from "viewer/model/accessors/volumetracing_accessor";
import {
  refreshMeshAction,
  removeMeshAction,
  triggerMeshesDownloadAction,
  updateMeshVisibilityAction,
} from "viewer/model/actions/annotation_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "viewer/model/actions/segmentation_actions";
import type { MeshInformation, Segment } from "viewer/store";
import Store from "viewer/store";

export type MeshOperations = {
  // Meshes (of the current additional coordinates) by segment id.
  meshes: Record<number, MeshInformation>;
  loadPrecomputedMeshes: (segments: Segment[]) => void;
  loadAdHocMeshes: (segments: Segment[]) => void;
  refreshMeshes: (segments: Segment[]) => void;
  removeMeshes: (segments: Segment[]) => void;
  downloadMeshes: (segments: Segment[]) => void;
  setMeshVisibility: (segments: Segment[], isVisible: boolean) => void;
  hasAnyMeshes: (segments: Segment[]) => boolean;
  getMeshVisibilityState: (segments: Segment[]) => {
    areSomeMeshesVisible: boolean;
    areSomeMeshesInvisible: boolean;
  };
};

function notifyAboutMissingPositions(segments: Segment[]) {
  const segmentIdsWithoutPosition = segments
    .filter((segment) => segment.anchorPosition == null)
    .map((segment) => segment.id)
    .sort();

  if (segmentIdsWithoutPosition.length > 0) {
    console.log(`Segments with unknown positions: ${segmentIdsWithoutPosition}`);
    Toast.info(
      `${pluralize("mesh", segmentIdsWithoutPosition.length, "meshes")} couldn't be loaded because the segment position is unknown. The segment IDs were printed to the console.`,
    );
  }
}

/*
 * Bulk mesh operations that act on a list of segments (e.g., the current
 * selection or all segments of a group).
 */
export function useMeshOperations(): MeshOperations {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationStateByLayer[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const meshes =
    useWkSelector((state) =>
      visibleSegmentationLayer != null
        ? getMeshesForCurrentAdditionalCoordinates(state, visibleSegmentationLayer.name)
        : undefined,
    ) ?? (EMPTY_OBJECT as Record<number, MeshInformation>);

  const loadPrecomputedMeshes = useCallback(
    (segments: Segment[]) => {
      if (currentMeshFile == null) {
        return;
      }
      for (const segment of segments) {
        if (segment.anchorPosition == null) {
          continue;
        }
        dispatch(
          loadPrecomputedMeshAction(
            segment.id,
            segment.anchorPosition,
            segment.additionalCoordinates,
            currentMeshFile.name,
            undefined,
            undefined,
          ),
        );
      }
      notifyAboutMissingPositions(segments);
    },
    [dispatch, currentMeshFile],
  );

  const loadAdHocMeshes = useCallback(
    (segments: Segment[]) => {
      const { additionalCoordinates } = Store.getState().flycam;
      for (const segment of segments) {
        if (segment.anchorPosition == null) {
          continue;
        }
        dispatch(loadAdHocMeshAction(segment.id, segment.anchorPosition, additionalCoordinates));
      }
      notifyAboutMissingPositions(segments);
    },
    [dispatch],
  );

  const forEachSegmentWithMesh = useCallback(
    (segments: Segment[], callback: (segment: Segment, layerName: string) => void) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      for (const segment of segments) {
        if (meshes[segment.id] != null) {
          callback(segment, visibleSegmentationLayer.name);
        }
      }
    },
    [visibleSegmentationLayer, meshes],
  );

  const refreshMeshes = useCallback(
    (segments: Segment[]) =>
      forEachSegmentWithMesh(segments, (segment, layerName) =>
        dispatch(refreshMeshAction(layerName, segment.id)),
      ),
    [dispatch, forEachSegmentWithMesh],
  );

  const removeMeshes = useCallback(
    (segments: Segment[]) =>
      forEachSegmentWithMesh(segments, (segment, layerName) =>
        dispatch(removeMeshAction(layerName, segment.id)),
      ),
    [dispatch, forEachSegmentWithMesh],
  );

  const setMeshVisibility = useCallback(
    (segments: Segment[], isVisible: boolean) => {
      const { additionalCoordinates } = Store.getState().flycam;
      forEachSegmentWithMesh(segments, (segment, layerName) =>
        dispatch(
          updateMeshVisibilityAction(layerName, segment.id, isVisible, additionalCoordinates),
        ),
      );
    },
    [dispatch, forEachSegmentWithMesh],
  );

  const downloadMeshes = useCallback(
    (segments: Segment[]) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      dispatch(
        triggerMeshesDownloadAction(
          segments.map((segment) => ({
            segmentName: segment.name ?? "mesh",
            segmentId: segment.id,
            layerName: visibleSegmentationLayer.name,
          })),
        ),
      );
    },
    [dispatch, visibleSegmentationLayer],
  );

  const hasAnyMeshes = useCallback(
    (segments: Segment[]) => segments.some((segment) => meshes[segment.id] != null),
    [meshes],
  );

  const getMeshVisibilityState = useCallback(
    (segments: Segment[]) => {
      const meshesOfSegments = segments.flatMap((segment) => meshes[segment.id] ?? []);
      return {
        areSomeMeshesVisible: meshesOfSegments.some((mesh) => mesh.isVisible),
        areSomeMeshesInvisible: meshesOfSegments.some((mesh) => !mesh.isVisible),
      };
    },
    [meshes],
  );

  return {
    meshes,
    loadPrecomputedMeshes,
    loadAdHocMeshes,
    refreshMeshes,
    removeMeshes,
    downloadMeshes,
    setMeshVisibility,
    hasAnyMeshes,
    getMeshVisibilityState,
  };
}
