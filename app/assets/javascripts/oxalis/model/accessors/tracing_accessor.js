// @flow

import type { TracingType, VolumeTracingType, SkeletonTracingType } from "oxalis/store";

export function getSomeTracing(
  tracing: TracingType,
): SkeletonTracingType | VolumeTracingType {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volume != null) {
    return tracing.volume;
  }
  throw new Error("The active tracing does not contain skeletons nor volume data");
}

export default {};
