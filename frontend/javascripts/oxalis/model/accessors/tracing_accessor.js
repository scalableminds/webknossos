// @flow

import type {
  OxalisState,
  ReadOnlyTracing,
  SkeletonTracing,
  Tracing,
  VolumeTracing,
} from "oxalis/store";
import { type ServerTracing, type TracingType, TracingTypeEnum } from "types/api_flow_types";

export function maybeGetSomeTracing(
  tracing: Tracing,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing | null {
  if (tracing.skeleton != null) {
    return tracing.skeleton;
  } else if (tracing.volumes.length > 0) {
    return tracing.volumes[0];
  } else if (tracing.readOnly != null) {
    return tracing.readOnly;
  }
  return null;
}

export function getSomeTracing(
  tracing: Tracing,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing {
  const maybeSomeTracing = maybeGetSomeTracing(tracing);
  if (maybeSomeTracing == null) {
    throw new Error("The active annotation does not contain skeletons nor volume data");
  }
  return maybeSomeTracing;
}

export function getSomeServerTracing(serverTracings: Array<ServerTracing>): ServerTracing {
  if (serverTracings.length > 0) {
    return serverTracings[0];
  }
  throw new Error("The active annotation does not contain skeletons nor volume data");
}

export function getTracingType(tracing: Tracing): TracingType {
  if (tracing.skeleton != null && tracing.volumes.length > 0) {
    return TracingTypeEnum.hybrid;
  } else if (tracing.skeleton != null) {
    return TracingTypeEnum.skeleton;
  } else if (tracing.volumes.length > 0) {
    return TracingTypeEnum.volume;
  }
  throw new Error("The active annotation does not contain skeletons nor volume data");
}

export function selectTracing(
  state: OxalisState,
  tracingType: "skeleton" | "volume",
  tracingId: string,
): SkeletonTracing | VolumeTracing {
  if (tracingType === "skeleton") {
    if (state.tracing.skeleton == null) {
      throw new Error(`Skeleton tracing with id ${tracingId} not found`);
    }
    return state.tracing.skeleton;
  }

  const volumeTracing = state.tracing.volumes.find(tracing => tracing.tracingId === tracingId);
  if (volumeTracing == null) {
    throw new Error(`Volume tracing with id ${tracingId} not found`);
  }

  return volumeTracing;
}
