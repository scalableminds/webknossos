import type {
  EditableMapping,
  OxalisState,
  ReadOnlyTracing,
  SkeletonTracing,
  Tracing,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import type { ServerTracing, TracingType } from "types/api_flow_types";
import { TracingTypeEnum } from "types/api_flow_types";
import type { SaveQueueType } from "oxalis/model/actions/save_actions";

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
  tracingType: SaveQueueType,
  tracingId: string,
): SkeletonTracing | VolumeTracing | EditableMapping {
  let tracing;

  switch (tracingType) {
    case "skeleton": {
      tracing = state.tracing.skeleton;
      break;
    }
    case "volume": {
      tracing = state.tracing.volumes.find(
        (volumeTracing) => volumeTracing.tracingId === tracingId,
      );
      break;
    }
    case "mapping": {
      tracing = state.tracing.mappings.find((mapping) => mapping.tracingId === tracingId);
      break;
    }
    default: {
      throw new Error(`Unknown tracing type: ${tracingType}`);
    }
  }

  if (tracing == null) {
    throw new Error(`${tracingType} object with id ${tracingId} not found`);
  }

  return tracing;
}
export const getUserBoundingBoxesFromState = (state: OxalisState): Array<UserBoundingBox> => {
  const maybeSomeTracing = maybeGetSomeTracing(state.tracing);
  return maybeSomeTracing != null ? maybeSomeTracing.userBoundingBoxes : [];
};
