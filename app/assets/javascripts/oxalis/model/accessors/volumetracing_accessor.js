/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { TracingType, VolumeTracingType, OxalisState } from "oxalis/store";
import type { VolumeToolType, ContourModeType } from "oxalis/constants";
import type { ServerTracingType, ServerVolumeTracingType } from "admin/api_flow_types";

export function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.type === "volume") {
    return Maybe.Just(tracing);
  }
  return Maybe.Nothing();
}

export function serverTracingAsVolumeTracingMaybe(
  tracing: ?ServerTracingType,
): Maybe<ServerVolumeTracingType> {
  if (tracing && tracing.elementClass) {
    return Maybe.Just(tracing);
  } else {
    return Maybe.Nothing();
  }
}

export function enforceVolumeTracing(tracing: TracingType): VolumeTracingType {
  return getVolumeTracing(tracing).get();
}

export function getActiveCellId(tracing: TracingType): Maybe<number> {
  return getVolumeTracing(tracing).map(volumeTracing => {
    const { activeCellId } = volumeTracing;
    return activeCellId;
  });
}

export function getVolumeTool(tracing: TracingType): Maybe<VolumeToolType> {
  return getVolumeTracing(tracing).map(volumeTracing => {
    const { activeTool } = volumeTracing;
    return activeTool;
  });
}

export function getContourTracingMode(tracing: TracingType): Maybe<ContourModeType> {
  return getVolumeTracing(tracing).map(volumeTracing => {
    const { contourTracingMode } = volumeTracing;
    return contourTracingMode;
  });
}

export function isVolumeTracingDisallowed(state: OxalisState) {
  const isVolumeTracing = state.tracing.type === "volume";
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
