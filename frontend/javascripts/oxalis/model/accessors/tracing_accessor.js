// @flow

import type {
  HybridServerTracing,
  ServerSkeletonTracing,
  ServerVolumeTracing,
  TracingType,
} from "types/api_flow_types";
import { TracingTypeEnum } from "types/api_flow_types";
import type { Tracing, VolumeTracing, SkeletonTracing, ReadOnlyTracing } from "oxalis/store";

export function maybeGetSomeTracing(
  tracing: Tracing,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing | null {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volume != null) {
    return tracing.volume;
  } else if (tracing.readOnly != null) {
    return tracing.readOnly;
  }
  return null;
}

export function getSomeTracing(
  tracing: Tracing,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volume != null) {
    return tracing.volume;
  } else if (tracing.readOnly != null) {
    return tracing.readOnly;
  }
  throw new Error("The active annotation does not contain skeletons nor volume data");
}

export function getSomeServerTracing(
  tracing: HybridServerTracing,
): ServerSkeletonTracing | ServerVolumeTracing {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volume != null) {
    return tracing.volume;
  }
  throw new Error("The active annotation does not contain skeletons nor volume data");
}

export function getTracingType(tracing: Tracing): TracingType {
  if (tracing.skeleton != null && tracing.volume != null) {
    return TracingTypeEnum.hybrid;
  } else if (tracing.skeleton != null) {
    return TracingTypeEnum.skeleton;
  } else if (tracing.volume != null) {
    return TracingTypeEnum.volume;
  }
  throw new Error("The active annotation does not contain skeletons nor volume data");
}

export default {};
