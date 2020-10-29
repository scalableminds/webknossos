/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { Tracing, VolumeTracing, OxalisState } from "oxalis/store";
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

export function isVolumeTracingDisallowed(state: OxalisState) {
  const isVolumeTracing = state.tracing.volume != null;
  const isWrongZoomStep = getRequestLogZoomStep(state) > 1;
  return isVolumeTracing && isWrongZoomStep;
}

export function isSegmentationMissingForZoomstep(
  state: OxalisState,
  maxZoomStepForSegmentation: number,
): boolean {
  return getRequestLogZoomStep(state) > maxZoomStepForSegmentation;
}
