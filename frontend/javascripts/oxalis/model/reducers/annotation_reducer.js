// @flow

import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, UserBoundingBox } from "oxalis/store";
import {
  type StateShape1,
  updateKey,
  updateKey2,
  updateKey3,
} from "oxalis/model/helpers/deep_update";
import { convertServerAnnotationToFrontendAnnotation } from "oxalis/model/reducers/reducer_helpers";

const updateTracing = (state: OxalisState, shape: StateShape1<"tracing">): OxalisState =>
  updateKey(state, "tracing", shape);

const updateUserBoundingBoxes = (state: OxalisState, userBoundingBoxes: Array<UserBoundingBox>) => {
  const updaterObject = {
    userBoundingBoxes: {
      $set: userBoundingBoxes,
    },
  };
  // We mirror/sync the user bounding boxes between all tracing objects.
  const maybeSkeletonUpdater = state.tracing.skeleton ? { skeleton: updaterObject } : {};
  const maybeVolumeUpdater = state.tracing.volume ? { volume: updaterObject } : {};
  const maybeReadOnlyUpdater = state.tracing.readOnly ? { readOnly: updaterObject } : {};
  return update(state, {
    tracing: {
      ...maybeSkeletonUpdater,
      // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
      ...maybeVolumeUpdater,
      ...maybeReadOnlyUpdater,
    },
  });
};

function AnnotationReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "INITIALIZE_ANNOTATION": {
      const annotationInfo = convertServerAnnotationToFrontendAnnotation(action.annotation);
      return updateTracing(state, annotationInfo);
    }
    case "SET_ANNOTATION_NAME": {
      const { name } = action;
      return updateTracing(state, {
        name,
      });
    }

    case "SET_ANNOTATION_VISIBILITY": {
      const { visibility } = action;
      return updateTracing(state, {
        visibility,
      });
    }

    case "SET_ANNOTATION_DESCRIPTION": {
      const { description } = action;
      return updateTracing(state, {
        description,
      });
    }

    case "SET_ANNOTATION_ALLOW_UPDATE": {
      const { allowUpdate } = action;
      return updateKey2(state, "tracing", "restrictions", { allowUpdate });
    }

    case "SET_USER_BOUNDING_BOXES": {
      return updateUserBoundingBoxes(state, action.userBoundingBoxes);
    }

    case "ADD_USER_BOUNDING_BOXES": {
      const tracing = state.tracing.skeleton || state.tracing.volume || state.tracing.readOnly;
      if (tracing == null) {
        return state;
      }
      let highestBoundingBoxId = Math.max(-1, ...tracing.userBoundingBoxes.map(bb => bb.id));
      const additionalUserBoundingBoxes = action.userBoundingBoxes.map(bb => {
        highestBoundingBoxId++;
        return { ...bb, id: highestBoundingBoxId };
      });
      const mergedUserBoundingBoxes = [
        ...tracing.userBoundingBoxes,
        ...additionalUserBoundingBoxes,
      ];
      return updateUserBoundingBoxes(state, mergedUserBoundingBoxes);
    }

    case "UPDATE_LOCAL_MESH_METADATA":
    case "UPDATE_REMOTE_MESH_METADATA": {
      const { id, meshShape } = action;
      const newMeshes = state.tracing.meshes.map(mesh => {
        if (mesh.id === id) {
          return { ...mesh, ...meshShape, id };
        } else {
          return mesh;
        }
      });
      return updateKey(state, "tracing", { meshes: newMeshes });
    }

    case "UPDATE_ISOSURFACE_VISIBILITY": {
      const { layerName, id, visibility } = action;
      // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
      return updateKey3(state, "isosurfacesByLayer", layerName, id, {
        isVisible: visibility,
      });
    }

    case "ADD_MESH_METADATA": {
      const newMeshes = state.tracing.meshes.concat(action.mesh);
      return updateKey(state, "tracing", { meshes: newMeshes });
    }

    case "DELETE_MESH": {
      const { id } = action;
      const newMeshes = state.tracing.meshes.filter(mesh => mesh.id !== id);
      return updateKey(state, "tracing", { meshes: newMeshes });
    }

    case "REMOVE_ISOSURFACE": {
      const { layerName, cellId } = action;
      return update(state, {
        isosurfacesByLayer: { [layerName]: { $unset: [cellId] } },
      });
    }

    case "ADD_ISOSURFACE": {
      const { layerName, cellId, seedPosition, isPrecomputed } = action;
      // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
      return updateKey3(state, "isosurfacesByLayer", layerName, cellId, {
        segmentId: cellId,
        seedPosition,
        isLoading: false,
        isVisible: true,
        isPrecomputed,
      });
    }

    case "STARTED_LOADING_ISOSURFACE": {
      const { layerName, cellId } = action;
      // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
      return updateKey3(state, "isosurfacesByLayer", layerName, cellId, {
        isLoading: true,
      });
    }

    case "FINISHED_LOADING_ISOSURFACE": {
      const { layerName, cellId } = action;
      // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
      return updateKey3(state, "isosurfacesByLayer", layerName, cellId, {
        isLoading: false,
      });
    }

    case "UPDATE_MESH_FILE_LIST": {
      const { layerName, meshFiles } = action;
      return update(state, { availableMeshFilesByLayer: { [layerName]: { $set: meshFiles } } });
    }

    case "UPDATE_CURRENT_MESH_FILE": {
      const { layerName, meshFile } = action;
      return update(state, { currentMeshFileByLayer: { [layerName]: { $set: meshFile } } });
    }

    default:
      return state;
  }
}

export default AnnotationReducer;
