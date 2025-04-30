import type { Vector3 } from "oxalis/constants";
import type { SaveQueueType } from "oxalis/model/actions/save_actions";
import type {
  EditableMapping,
  OxalisState,
  ReadOnlyTracing,
  SkeletonTracing,
  StoreAnnotation,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import type { ServerTracing, TracingType } from "types/api_types";
import { TracingTypeEnum } from "types/api_types";
import BoundingBox from "../bucket_data_handling/bounding_box";

export function maybeGetSomeTracing(
  annotation: StoreAnnotation,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing | null {
  if (annotation.skeleton != null) {
    return annotation.skeleton;
  } else if (annotation.volumes.length > 0) {
    return annotation.volumes[0];
  } else if (annotation.readOnly != null) {
    return annotation.readOnly;
  }

  return null;
}
export function getSomeTracing(
  annotation: StoreAnnotation,
): SkeletonTracing | VolumeTracing | ReadOnlyTracing {
  const maybeSomeTracing = maybeGetSomeTracing(annotation);

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
export function getTracingType(annotation: StoreAnnotation): TracingType {
  if (annotation.skeleton != null && annotation.volumes.length > 0) {
    return TracingTypeEnum.hybrid;
  } else if (annotation.skeleton != null) {
    return TracingTypeEnum.skeleton;
  } else if (annotation.volumes.length > 0) {
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
      tracing = state.annotation.skeleton;
      break;
    }
    case "volume": {
      tracing = state.annotation.volumes.find(
        (volumeTracing) => volumeTracing.tracingId === tracingId,
      );
      break;
    }
    case "mapping": {
      tracing = state.annotation.mappings.find((mapping) => mapping.tracingId === tracingId);
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
  const maybeSomeTracing = maybeGetSomeTracing(state.annotation);
  return maybeSomeTracing != null ? maybeSomeTracing.userBoundingBoxes : [];
};

export const getUserBoundingBoxesThatContainPosition = (
  state: OxalisState,
  position: Vector3,
): Array<UserBoundingBox> => {
  const bboxes = getUserBoundingBoxesFromState(state);

  return bboxes.filter((el) => new BoundingBox(el.boundingBox).containsPoint(position));
};
