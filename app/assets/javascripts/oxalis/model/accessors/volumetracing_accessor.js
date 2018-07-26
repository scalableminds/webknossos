/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { TracingType, VolumeTracingType, OxalisState } from "oxalis/store";
import type { VolumeToolType, ContourModeType } from "oxalis/constants";
import type { HybridServerTracingType, ServerVolumeTracingType } from "admin/api_flow_types";

export function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.volume != null) {
    return Maybe.Just(tracing.volume);
  }
  return Maybe.Nothing();
}

export function serverTracingAsVolumeTracingMaybe(
  tracing: ?HybridServerTracingType,
): Maybe<ServerVolumeTracingType> {
  if (tracing && tracing.volume) {
    return Maybe.Just(tracing.volume);
  } else {
    return Maybe.Nothing();
  }
}

export function enforceVolumeTracing(tracing: TracingType): VolumeTracingType {
  return getVolumeTracing(tracing).get();
}

export function getActiveCellId(volumeTracing: VolumeTracingType): number {
  const { activeCellId } = volumeTracing;
  return activeCellId;
}

export function getVolumeTool(volumeTracing: VolumeTracingType): VolumeToolType {
  const { activeTool } = volumeTracing;
  return activeTool;
}

export function getContourTracingMode(volumeTracing: VolumeTracingType): ContourModeType {
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

export function displaysDownsampledVolumeData(
  state: OxalisState,
  maxUnsampledZoomStepForSegmentation: number,
): boolean {
  return getRequestLogZoomStep(state) === maxUnsampledZoomStepForSegmentation + 1;
}
