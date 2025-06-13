import _ from "lodash";
import type { ServerTracing, TracingType } from "types/api_types";
import { TracingTypeEnum } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { SaveQueueType } from "viewer/model/actions/save_actions";
import type { UserBoundingBox } from "viewer/store";
import type {
  EditableMapping,
  ReadOnlyTracing,
  SkeletonTracing,
  StoreAnnotation,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import BoundingBox from "../bucket_data_handling/bounding_box";
import { reuseInstanceOnEquality } from "./accessor_helpers";

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
  state: WebknossosState,
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

function _getTaskBoundingBoxes(state: WebknossosState) {
  const { annotation, task } = state;
  if (task == null) return {};
  const layers = _.compact([annotation.skeleton, ...annotation.volumes]);
  return Object.fromEntries(layers.map((l) => [l.tracingId, l.boundingBox]));
}

export const getTaskBoundingBoxes = reuseInstanceOnEquality(_getTaskBoundingBoxes);

export const getUserBoundingBoxesFromState = (state: WebknossosState): UserBoundingBox[] => {
  const maybeSomeTracing = maybeGetSomeTracing(state.annotation);
  return maybeSomeTracing != null ? maybeSomeTracing.userBoundingBoxes : [];
};

export const getUserBoundingBoxesThatContainPosition = (
  state: WebknossosState,
  position: Vector3,
): UserBoundingBox[] => {
  const bboxes = getUserBoundingBoxesFromState(state);

  return bboxes.filter((el) => new BoundingBox(el.boundingBox).containsPoint(position));
};
