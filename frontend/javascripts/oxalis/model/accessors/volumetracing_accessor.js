/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { Tracing, VolumeTracing, OxalisState } from "oxalis/store";
import Dimensions from "oxalis/model/dimensions";
import type { VolumeTool, ContourMode, Vector3, OrthoView } from "oxalis/constants";
import type { HybridServerTracing, ServerVolumeTracing } from "admin/api_flow_types";

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

export function getVolumeTool(volumeTracing: VolumeTracing): VolumeTool {
  const { activeTool } = volumeTracing;
  return activeTool;
}

export function getContourTracingMode(volumeTracing: VolumeTracing): ContourMode {
  const { contourTracingMode } = volumeTracing;
  return contourTracingMode;
}

export function isVolumeTraceToolDisallowed(state: OxalisState) {
  if (state.tracing.volume == null) {
    return false;
  }
  // The current resolution is to high for allowing the trace tool
  // because to many voxel could be annotated at the same time.
  const isZoomStepTooHigh = getRequestLogZoomStep(state) > 1;
  return isZoomStepTooHigh;
}

export function isSegmentationMissingForZoomstep(
  state: OxalisState,
  maxZoomStepForSegmentation: number,
): boolean {
  return getRequestLogZoomStep(state) > maxZoomStepForSegmentation;
}

export function getNumberOfSlicesForResolution(activeResolution: Vector3, activePlane: OrthoView) {
  const thirdDimenstionIndex = Dimensions.thirdDimensionForPlane(activePlane);
  const numberOfSlices = activeResolution[thirdDimenstionIndex];
  return numberOfSlices;
}
