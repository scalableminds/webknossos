/**
 * volumetracing_accessor.js
 * @flow
 */
import Maybe from "data.maybe";
import type { TracingType, VolumeTracingType } from "oxalis/store";
import type { VolumeModeType } from "oxalis/constants";

export function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.type === "volume") {
    return Maybe.Just(tracing);
  }
  return Maybe.Nothing();
}

export function getActiveCellId(tracing: TracingType): Maybe<number> {
  return getVolumeTracing(tracing).map((volumeTracing) => {
    const { activeCellId } = volumeTracing;
    return activeCellId;
  });
}

export function getMode(tracing: TracingType): Maybe<VolumeModeType> {
  return getVolumeTracing(tracing).map((volumeTracing) => {
    const { viewMode } = volumeTracing;
    return viewMode;
  });
}
