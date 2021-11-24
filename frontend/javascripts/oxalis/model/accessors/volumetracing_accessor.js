/**
 * volumetracing_accessor.js
 * @flow
 */
import memoizeOne from "memoize-one";

import type {
  ActiveMappingInfo,
  HybridTracing,
  OxalisState,
  SegmentMap,
  Tracing,
  VolumeTracing,
} from "oxalis/store";
import {
  type AnnotationTool,
  AnnotationToolEnum,
  type ContourMode,
  type Vector3,
  VolumeTools,
} from "oxalis/constants";
import {
  ResolutionInfo,
  getMappingInfo,
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
import { getMaxZoomStepDiff } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";

export function getVolumeTracings(tracing: Tracing): Array<VolumeTracing> {
  return tracing.volumes;
}

export function getVolumeTracingById(tracing: Tracing, tracingId: string): VolumeTracing {
  const volumeTracing = tracing.volumes.find(t => t.tracingId === tracingId);

  if (volumeTracing == null) {
    throw new Error(`Could not find volume tracing with id ${tracingId}`);
  }

  return volumeTracing;
}

export function getVolumeTracingByLayerName(tracing: Tracing, layerName: string): ?VolumeTracing {
  // Given a segmentation layer, there might be a corresponding volume tracing. In that case,
  // the layer name will be the tracing id.
  const volumeTracing = tracing.volumes.find(t => t.tracingId === layerName);
  return volumeTracing;
}

export function hasVolumeTracings(tracing: Tracing): boolean {
  return tracing.volumes.length > 0;
}

export function getVolumeDescriptors(
  annotation: APIAnnotation | APIAnnotationCompact | HybridTracing,
): Array<AnnotationLayerDescriptor> {
  return annotation.annotationLayers.filter(layer => layer.typ === "Volume");
}

export function getVolumeDescriptorById(
  annotation: APIAnnotation | APIAnnotationCompact | HybridTracing,
  tracingId: string,
): AnnotationLayerDescriptor {
  const descriptors = getVolumeDescriptors(annotation).filter(
    layer => layer.tracingId === tracingId,
  );
  if (descriptors.length === 0) {
    throw new Error(`Could not find volume descriptor with id ${tracingId}`);
  }
  return descriptors[0];
}

export function getReadableNameByVolumeTracingId(
  tracing: APIAnnotation | APIAnnotationCompact | HybridTracing,
  tracingId: string,
) {
  const volumeDescriptor = getVolumeDescriptorById(tracing, tracingId);
  return volumeDescriptor.name || "Volume Layer";
}

function getSegmentationLayerForTracing(
  state: OxalisState,
  volumeTracing: VolumeTracing,
): APISegmentationLayer {
  return getSegmentationLayerByName(state.dataset, volumeTracing.tracingId);
}

function _getResolutionInfoOfActiveSegmentationTracingLayer(state: OxalisState): ResolutionInfo {
  const volumeTracing = getActiveSegmentationTracing(state);
  if (!volumeTracing) {
    return new ResolutionInfo([]);
  }
  const segmentationLayer = getSegmentationLayerForTracing(state, volumeTracing);
  return getResolutionInfo(segmentationLayer.resolutions);
}

const getResolutionInfoOfActiveSegmentationTracingLayer = memoizeOne(
  _getResolutionInfoOfActiveSegmentationTracingLayer,
);

export function getServerVolumeTracings(
  tracings: ?Array<ServerTracing>,
): Array<ServerVolumeTracing> {
  // Type refinement by filtering does not work in flow.
  // See https://github.com/facebook/flow/issues/1414
  // $FlowIgnore[prop-missing]
  // $FlowIgnore[incompatible-type]
  const volumeTracings: Array<ServerVolumeTracing> = (tracings || []).filter(
    tracing => tracing.typ === "Volume",
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
): ?VolumeTracing {
  if (layer.tracingId != null) {
    return getVolumeTracingById(state.tracing, layer.tracingId);
  } else {
    return null;
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
    const tracing = getTracingForSegmentationLayer(state, layer);
    if (!tracing) {
      throw new Error(
        "Requested tracing layer is not a tracing, but a disk-based segmentation layer.",
      );
    }
    return tracing;
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

export function getActiveSegmentationTracing(state: OxalisState): ?VolumeTracing {
  return getRequestedOrDefaultSegmentationTracingLayer(state, null);
}

export function getActiveSegmentationTracingLayer(state: OxalisState): ?APISegmentationLayer {
  const tracing = getRequestedOrDefaultSegmentationTracingLayer(state, null);
  if (!tracing) {
    return null;
  }
  return getSegmentationLayerForTracing(state, tracing);
}

export function enforceActiveVolumeTracing(state: OxalisState): VolumeTracing {
  const tracing = getActiveSegmentationTracing(state);

  if (tracing == null) {
    throw new Error("No volume tracing is available or enabled.");
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

/*
  This function returns the resolution and zoom step in which the given segmentation
  tracing layer is currently rendered (if it is rendered). These properties should be used
  when labeling volume data.
 */
function _getRenderableResolutionForSegmentationTracing(
  state: OxalisState,
  segmentationTracing: ?VolumeTracing,
): ?{ resolution: Vector3, zoomStep: number } {
  if (!segmentationTracing) {
    return null;
  }
  const segmentationLayer = getSegmentationLayerForTracing(state, segmentationTracing);
  const requestedZoomStep = getRequestLogZoomStep(state);
  const { renderMissingDataBlack } = state.datasetConfiguration;
  const maxZoomStepDiff = getMaxZoomStepDiff(state.datasetConfiguration.loadingStrategy);
  const resolutionInfo = getResolutionInfo(segmentationLayer.resolutions);

  // Check whether the segmentation layer is enabled
  const segmentationSettings = state.datasetConfiguration.layers[segmentationLayer.name];
  if (segmentationSettings.isDisabled) {
    return null;
  }

  // Check whether the requested zoom step exists
  if (resolutionInfo.hasIndex(requestedZoomStep)) {
    return {
      zoomStep: requestedZoomStep,
      resolution: resolutionInfo.getResolutionByIndexOrThrow(requestedZoomStep),
    };
  }

  // Since `renderMissingDataBlack` is enabled, the fallback resolutions
  // should not be considered.
  if (renderMissingDataBlack) {
    return null;
  }

  // The current resolution is missing and fallback rendering
  // is activated. Thus, check whether one of the fallback
  // zoomSteps can be rendered.
  for (
    let fallbackZoomStep = requestedZoomStep + 1;
    fallbackZoomStep <= requestedZoomStep + maxZoomStepDiff;
    fallbackZoomStep++
  ) {
    if (resolutionInfo.hasIndex(fallbackZoomStep)) {
      return {
        zoomStep: fallbackZoomStep,
        resolution: resolutionInfo.getResolutionByIndexOrThrow(fallbackZoomStep),
      };
    }
  }

  return null;
}

export const getRenderableResolutionForSegmentationTracing = reuseInstanceOnEquality(
  _getRenderableResolutionForSegmentationTracing,
);

function _getRenderableResolutionForActiveSegmentationTracing(
  state: OxalisState,
): ?{ resolution: Vector3, zoomStep: number } {
  const activeSegmentationTracing = getActiveSegmentationTracing(state);
  return getRenderableResolutionForSegmentationTracing(state, activeSegmentationTracing);
}

export const getRenderableResolutionForActiveSegmentationTracing = reuseInstanceOnEquality(
  _getRenderableResolutionForActiveSegmentationTracing,
);

export function getMappingInfoForVolumeTracing(
  state: OxalisState,
  tracingId: ?string,
): ActiveMappingInfo {
  return getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId);
}
