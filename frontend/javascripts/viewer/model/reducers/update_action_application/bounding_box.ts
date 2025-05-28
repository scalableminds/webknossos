import update from "immutability-helper";
import * as Utils from "libs/utils";
import type {
  AddUserBoundingBoxInSkeletonTracingAction,
  AddUserBoundingBoxInVolumeTracingAction,
  DeleteUserBoundingBoxInSkeletonTracingAction,
  DeleteUserBoundingBoxInVolumeTracingAction,
  UpdateUserBoundingBoxInSkeletonTracingAction,
  UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/update_actions";
import type {
  SkeletonTracing,
  UserBoundingBox,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import { convertUserBoundingBoxFromUpdateActionToFrontend } from "../reducer_helpers";

export function applyUpdateUserBoundingBox(
  newState: WebknossosState,
  ua: UpdateUserBoundingBoxInSkeletonTracingAction | UpdateUserBoundingBoxInVolumeTracingAction,
) {
  // todop: dont pass state and instead do the update here?
  const { skeleton } = newState.annotation;
  if (skeleton == null) {
    throw new Error("No skeleton found to apply update to.");
  }

  const updatedUserBoundingBoxes = skeleton.userBoundingBoxes.map(
    (bbox): UserBoundingBox =>
      bbox.id === ua.value.boundingBoxId
        ? { ...bbox, ...convertUserBoundingBoxFromUpdateActionToFrontend(ua.value) }
        : bbox,
  );

  return handleUserBoundingBoxUpdateInTracing(newState, skeleton, updatedUserBoundingBoxes);
}

export function applyAddUserBoundingBox(
  newState: WebknossosState,
  ua: AddUserBoundingBoxInSkeletonTracingAction | AddUserBoundingBoxInVolumeTracingAction,
) {
  // todop: dont pass state and instead do the update here?
  const { skeleton } = newState.annotation;
  if (skeleton == null) {
    throw new Error("No skeleton found to apply update to.");
  }

  const { boundingBox, ...valueWithoutBoundingBox } = ua.value.boundingBox;
  const maybeBoundingBoxValue = {
    boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBox),
  };
  const newUserBBox: UserBoundingBox = {
    // The visibility is stored per user. Therefore, we default to true here.
    isVisible: true,
    ...valueWithoutBoundingBox,
    ...maybeBoundingBoxValue,
  };
  const updatedUserBoundingBoxes = skeleton.userBoundingBoxes.concat([newUserBBox]);

  return handleUserBoundingBoxUpdateInTracing(newState, skeleton, updatedUserBoundingBoxes);
}

export function applyDeleteUserBoundingBox(
  newState: WebknossosState,
  ua: DeleteUserBoundingBoxInSkeletonTracingAction | DeleteUserBoundingBoxInVolumeTracingAction,
) {
  const { skeleton } = newState.annotation;
  if (skeleton == null) {
    throw new Error("No skeleton found to apply update to.");
  }

  const updatedUserBoundingBoxes = skeleton.userBoundingBoxes.filter(
    (bbox) => bbox.id !== ua.value.boundingBoxId,
  );

  return handleUserBoundingBoxUpdateInTracing(newState, skeleton, updatedUserBoundingBoxes);
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
          updatedUserBoundingBoxes,
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
