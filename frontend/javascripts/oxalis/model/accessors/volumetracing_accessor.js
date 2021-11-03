/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import {
  getResolutionInfoOfSegmentationTracingLayer,
  getVisibleSegmentationLayer,
  getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import type { Tracing, VolumeTracing, OxalisState, SegmentMap } from "oxalis/store";
import { AnnotationToolEnum, VolumeTools } from "oxalis/constants";
import type { AnnotationTool, ContourMode } from "oxalis/constants";
import type {
  HybridServerTracing,
  ServerVolumeTracing,
  APISegmentationLayer,
} from "types/api_flow_types";

export function getVolumeTracing(tracing: Tracing): Maybe<VolumeTracing> {
  if (tracing.volume != null) {
    return Maybe.Just(tracing.volume);
  }
  return Maybe.Nothing();
}

export function serverTracingAsVolumeTracingMaybe(
  tracing: ?HybridServerTracing,
): Maybe<ServerVolumeTracing> {
  if (tracing && tracing.volume) {
    return Maybe.Just(tracing.volume);
  } else {
    return Maybe.Nothing();
  }
}

export function enforceVolumeTracing(tracing: Tracing): VolumeTracing {
  return getVolumeTracing(tracing).get();
}

export function getActiveCellId(volumeTracing: VolumeTracing): number {
  const { activeCellId } = volumeTracing;
  return activeCellId;
}

export function getContourTracingMode(volumeTracing: VolumeTracing): ContourMode {
  const { contourTracingMode } = volumeTracing;
  return contourTracingMode;
}

const MAG_THRESHOLDS_FOR_ZOOM: { [AnnotationTool]: number } = {
  [AnnotationToolEnum.TRACE]: 1,
  [AnnotationToolEnum.ERASE_TRACE]: 1,
  [AnnotationToolEnum.BRUSH]: 3,
  [AnnotationToolEnum.ERASE_BRUSH]: 3,
  [AnnotationToolEnum.FILL_CELL]: 1,
};

export function isVolumeTool(tool: AnnotationTool): boolean {
  return VolumeTools.indexOf(tool) > -1;
}

export function isVolumeAnnotationDisallowedForZoom(tool: AnnotationTool, state: OxalisState) {
  if (state.tracing.volume == null) {
    return true;
  }

  const threshold = MAG_THRESHOLDS_FOR_ZOOM[tool];

  if (threshold == null) {
    // If there is no threshold for the provided tool, it doesn't need to be
    // disabled.
    return false;
  }

  const volumeResolutions = getResolutionInfoOfSegmentationTracingLayer(state.dataset);
  const lowestExistingResolutionIndex = volumeResolutions.getClosestExistingIndex(0);

  // The current resolution is too high for the tool
  // because too many voxels could be annotated at the same time.
  const isZoomStepTooHigh =
    getRequestLogZoomStep(state) > threshold + lowestExistingResolutionIndex;
  return isZoomStepTooHigh;
}

export function isSegmentationMissingForZoomstep(
  state: OxalisState,
  maxZoomStepForSegmentation: number,
): boolean {
  return getRequestLogZoomStep(state) > maxZoomStepForSegmentation;
}

export function getRequestedOrVisibleSegmentationLayer(
  state: OxalisState,
  layerName: ?string,
): ?APISegmentationLayer {
  const requestedLayer =
    layerName != null ? getSegmentationLayerByName(state.dataset, layerName) : null;
  return requestedLayer || getVisibleSegmentationLayer(state);
}

export function getRequestedOrVisibleSegmentationLayerEnforced(
  state: OxalisState,
  layerName: ?string,
): APISegmentationLayer {
  const effectiveLayer = getRequestedOrVisibleSegmentationLayer(state, layerName);
  if (effectiveLayer != null) {
    return effectiveLayer;
  }
  // If a layerName is passed and invalid, an exception will be raised by getRequestedOrVisibleSegmentationLayer.
  throw new Error(
    "No segmentation layer is currently visible. Pass a valid layerName (you may want to use `getSegmentationLayerName`)",
  );
}

export function getNameOfRequestedOrVisibleSegmentationLayer(
  state: OxalisState,
  layerName: ?string,
): ?string {
  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);
  return layer != null ? layer.name : null;
}

export function getSegmentsForLayer(state: OxalisState, layerName: ?string): ?SegmentMap {
  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);

  if (layer == null) {
    return null;
  }

  if (layer.isTracingLayer && state.tracing.volume != null) {
    return state.tracing.volume.segments;
  }

  return state.localSegmentationData[layer.name].segments;
}

export function getVisibleSegments(state: OxalisState): ?SegmentMap {
  const layer = getVisibleSegmentationLayer(state);
  if (layer == null) {
    return null;
  }

  if (layer.isTracingLayer && state.tracing.volume != null) {
    return state.tracing.volume.segments;
  }

  return state.localSegmentationData[layer.name].segments;
}
