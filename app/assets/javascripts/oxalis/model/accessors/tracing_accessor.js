// @flow

import type {
  TracingType,
  VolumeTracingType,
  SkeletonTracingType,
  ReadOnlyTracingType,
} from "oxalis/store";

export function getSomeTracing(
  tracing: TracingType,
): SkeletonTracingType | VolumeTracingType | ReadOnlyTracingType {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volume != null) {
    return tracing.volume;
  } else if (tracing.readOnly != null) {
    return tracing.readOnly;
  }
  throw new Error("The active tracing does not contain skeletons nor volume data");
}

export default {};
