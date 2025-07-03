import update from "immutability-helper";
import * as Utils from "libs/utils";
import type {
  AddUserBoundingBoxInSkeletonTracingAction,
  AddUserBoundingBoxInVolumeTracingAction,
  DeleteUserBoundingBoxInSkeletonTracingAction,
  DeleteUserBoundingBoxInVolumeTracingAction,
  UpdateUserBoundingBoxInSkeletonTracingAction,
  UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/volume/update_actions";
import type {
  SkeletonTracing,
  UserBoundingBox,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import { convertUserBoundingBoxFromUpdateActionToFrontend } from "../reducer_helpers";

export function applyUpdateUserBoundingBox(
  newState: WebknossosState,
  tracing: SkeletonTracing | VolumeTracing,
  ua: UpdateUserBoundingBoxInSkeletonTracingAction | UpdateUserBoundingBoxInVolumeTracingAction,
) {
  const updatedUserBoundingBoxes = tracing.userBoundingBoxes.map(
    (bbox): UserBoundingBox =>
      bbox.id === ua.value.boundingBoxId
        ? { ...bbox, ...convertUserBoundingBoxFromUpdateActionToFrontend(ua.value) }
        : bbox,
  );

  return handleUserBoundingBoxUpdateInTracing(newState, tracing, updatedUserBoundingBoxes);
}

export function applyAddUserBoundingBox(
  newState: WebknossosState,
  tracing: SkeletonTracing | VolumeTracing,
  ua: AddUserBoundingBoxInSkeletonTracingAction | AddUserBoundingBoxInVolumeTracingAction,
) {
  const { boundingBox, ...valueWithoutBoundingBox } = ua.value.boundingBox;
  const boundingBoxValue = {
    boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBox),
  };
  const newUserBBox: UserBoundingBox = {
    // The visibility is stored per user. Therefore, we default to true here.
    isVisible: true,
    ...valueWithoutBoundingBox,
    ...boundingBoxValue,
  };
  const updatedUserBoundingBoxes = tracing.userBoundingBoxes.concat([newUserBBox]);

  return handleUserBoundingBoxUpdateInTracing(newState, tracing, updatedUserBoundingBoxes);
}

export function applyDeleteUserBoundingBox(
  newState: WebknossosState,
  tracing: SkeletonTracing | VolumeTracing,
  ua: DeleteUserBoundingBoxInSkeletonTracingAction | DeleteUserBoundingBoxInVolumeTracingAction,
) {
  const updatedUserBoundingBoxes = tracing.userBoundingBoxes.filter(
    (bbox) => bbox.id !== ua.value.boundingBoxId,
  );

  return handleUserBoundingBoxUpdateInTracing(newState, tracing, updatedUserBoundingBoxes);
}

function handleUserBoundingBoxUpdateInTracing(
  state: WebknossosState,
  tracing: SkeletonTracing | VolumeTracing,
  updatedUserBoundingBoxes: UserBoundingBox[],
) {
  if (tracing.type === "skeleton") {
    return update(state, {
      annotation: {
        skeleton: {
          userBoundingBoxes: {
            $set: updatedUserBoundingBoxes,
          },
        },
      },
    });
  }

  const newVolumes = state.annotation.volumes.map((volumeTracing) =>
    tracing.tracingId === volumeTracing.tracingId
      ? {
          ...volumeTracing,
          userBoundingBoxes: updatedUserBoundingBoxes,
        }
      : volumeTracing,
  );

  return update(state, {
    annotation: {
      volumes: {
        $set: newVolumes,
      },
    },
  });
}
