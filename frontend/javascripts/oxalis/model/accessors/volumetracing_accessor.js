/**
 * volumetracing_accessor.js
 * @flow
 */
import memoizeOne from "memoize-one";

import {
  type AnnotationTool,
  AnnotationToolEnum,
  type ContourMode,
  VolumeTools,
} from "oxalis/constants";
import {
  ResolutionInfo,
  getResolutionInfo,
  getSegmentationLayerByName,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import type {
  ServerTracing,
  ServerVolumeTracing,
  APIAnnotation,
  AnnotationLayerDescriptor,
  APIAnnotationCompact,
  APISegmentationLayer,
} from "types/api_flow_types";
import type { Tracing, VolumeTracing, OxalisState, SegmentMap } from "oxalis/store";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";

export function getVolumeTracingById(tracing: Tracing, tracingId: string): VolumeTracing {
  const volumeTracing = tracing.volumes.find(t => t.tracingId === tracingId);

  if (volumeTracing == null) {
    throw new Error(`Could not find volume tracing with id ${tracingId}`);
  }

  return volumeTracing;
}

export function hasVolumeTracings(tracing: Tracing): boolean {
  return tracing.volumes.length > 0;
}

export function getVolumeDescriptors(
  annotation: APIAnnotation | APIAnnotationCompact,
): Array<AnnotationLayerDescriptor> {
  return annotation.annotationLayers.filter(layer => layer.typ === "Volume");
}

export function getVolumeTracings(tracings: ?Array<ServerTracing>): Array<ServerVolumeTracing> {
  // todo: add a type property to ServerTracing
  // $FlowIgnore[prop-missing]
  // $FlowIgnore[incompatible-type]
  const volumeTracings: Array<ServerVolumeTracing> = (tracings || []).filter(
    // $FlowIgnore[prop-missing]
    tracing => tracing.largestSegmentId != null,
  );
  return volumeTracings;
}

function getSegmentationLayerForTracing(
  state: OxalisState,
  volumeTracing: VolumeTracing,
): APISegmentationLayer {
  return getSegmentationLayerByName(state.dataset, volumeTracing.tracingId);
}

function _getResolutionInfoOfActiveSegmentationTracingLayer(state: OxalisState): ResolutionInfo {
  const volumeTracing = getActiveSegmentationTracingLayer(state);
  if (!volumeTracing) {
    return new ResolutionInfo([]);
  }
  const segmentationLayer = getSegmentationLayerForTracing(state, volumeTracing);
  return getResolutionInfo(segmentationLayer.resolutions);
}

export const getResolutionInfoOfActiveSegmentationTracingLayer = memoizeOne(
  _getResolutionInfoOfActiveSegmentationTracingLayer,
);

// todo: adapt callers to multiple volume annotations
export function serverTracingAsVolumeTracings(
  tracings: ?Array<ServerTracing>,
): Array<ServerVolumeTracing> {
  // todo
  // $FlowIgnore[prop-missing]
  // $FlowIgnore[incompatible-type]
  const volumeTracings: Array<ServerVolumeTracing> = (tracings || []).filter(
    // $FlowIgnore[prop-missing]
    tracing => tracing.largestSegmentId != null,
  );
  return volumeTracings;
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
  if (state.tracing.volumes.length === 0) {
    return true;
  }

  const threshold = MAG_THRESHOLDS_FOR_ZOOM[tool];

  if (threshold == null) {
    // If there is no threshold for the provided tool, it doesn't need to be
    // disabled.
    return false;
  }

  const volumeResolutions = getResolutionInfoOfActiveSegmentationTracingLayer(state);
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

function getTracingForSegmentationLayer(
  state: OxalisState,
  layer: APISegmentationLayer,
): VolumeTracing {
  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId);
  } else {
    throw new Error(
      "Requested tracing layer is not a tracing, but a disk-based segmentation layer.",
    );
  }
}

export function getRequestedOrDefaultSegmentationTracingLayer(
  state: OxalisState,
  layerName: ?string,
): ?VolumeTracing {
  // If a layerName is passed, the corresponding volume tracing layer is returned.
  // Otherwise:
  //   if there's only one volume tracing layer, return that.
  //   else: return the visible volume tracing layer

  if (layerName != null) {
    const layer = getSegmentationLayerByName(state.dataset, layerName);
    return getTracingForSegmentationLayer(state, layer);
  }

  if (state.tracing.volumes.length === 1) {
    return state.tracing.volumes[0];
  }

  const visibleLayer = getVisibleSegmentationLayer(state);
  if (visibleLayer == null) {
    return null;
  }
  return getTracingForSegmentationLayer(state, visibleLayer);
}

export function getActiveSegmentationTracingLayer(state: OxalisState): ?VolumeTracing {
  return getRequestedOrDefaultSegmentationTracingLayer(state, null);
}

export function enforceActiveVolumeTracing(state: OxalisState): VolumeTracing {
  const tracing = getRequestedOrDefaultSegmentationTracingLayer(state, null);

  if (tracing == null) {
    throw new Error("No volume tracing is available.");
  }

  return tracing;
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

  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId).segments;
  }

  return state.localSegmentationData[layer.name].segments;
}

export function getVisibleSegments(state: OxalisState): ?SegmentMap {
  const layer = getVisibleSegmentationLayer(state);
  if (layer == null) {
    return null;
  }

  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId).segments;
  }

  return state.localSegmentationData[layer.name].segments;
}
