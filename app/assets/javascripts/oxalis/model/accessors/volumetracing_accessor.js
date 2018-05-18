/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import type { TracingType, VolumeTracingType, OxalisState } from "oxalis/store";
import type { VolumeToolType, ContourModeType } from "oxalis/constants";

export function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.type === "volume") {
    return Maybe.Just(tracing);
  }
  return Maybe.Nothing();
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
  return getRequestLogZoomStep(state) > 1;
}

export function displaysUnsampledVolumeData(state: OxalisState): boolean {
  return getRequestLogZoomStep(state) === 1;
}
