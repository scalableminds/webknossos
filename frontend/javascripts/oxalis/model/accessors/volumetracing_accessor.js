/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { Tracing, VolumeTracing, OxalisState } from "oxalis/store";
import { VolumeToolEnum } from "oxalis/constants";
import type { VolumeTool, ContourMode } from "oxalis/constants";
import type { HybridServerTracing, ServerVolumeTracing } from "types/api_flow_types";

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

const MAG_THRESHOLDS_FOR_ZOOM = {
  [VolumeToolEnum.TRACE]: 1,
  [VolumeToolEnum.BRUSH]: 3,
};
export function isVolumeAnnotationDisallowedForZoom(tool: VolumeTool, state: OxalisState) {
  if (state.tracing.volume == null) {
    return true;
  }

  const threshold = MAG_THRESHOLDS_FOR_ZOOM[tool];

  if (threshold == null) {
    // If there is no threshold for the provided tool, it doesn't need to be
    // disabled.
    return false;
  }

  // The current resolution is too high to allow the trace tool
  // because too many voxels could be annotated at the same time.
  const isZoomStepTooHigh = getRequestLogZoomStep(state) > threshold;
  return isZoomStepTooHigh;
}

export function isSegmentationMissingForZoomstep(
  state: OxalisState,
  maxZoomStepForSegmentation: number,
): boolean {
  return getRequestLogZoomStep(state) > maxZoomStepForSegmentation;
}
