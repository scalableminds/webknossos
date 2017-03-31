// @flow
import Maybe from "data.maybe";
import type { TracingType, VolumeTracingType } from "oxalis/store";

export function getVolumeTracing(tracing: TracingType): Maybe<VolumeTracingType> {
  if (tracing.type === "volume") {
    return Maybe.Just(tracing);
  }
  return Maybe.Nothing();
}

export function getActiveCellId(tracing: TracingType) {
  return getVolumeTracing(tracing).chain((volumeTracing) => {
    const { activeCellId } = volumeTracing;
    return Maybe.fromNullable(activeCellId);
  });
}
