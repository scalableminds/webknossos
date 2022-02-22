// @flow

import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, UserBoundingBox, IsosurfaceInformation } from "oxalis/store";
import { V3 } from "libs/mjs";
import {
  type StateShape1,
  type WriteableShape,
  updateKey,
  updateKey2,
  updateKey4,
} from "oxalis/model/helpers/deep_update";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import * as Utils from "libs/utils";
import { getDisplayedDataExtentInPlaneMode } from "oxalis/model/accessors/view_mode_accessor";
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

  const newVolumes = state.tracing.volumes.map(volumeTracing => ({
    ...volumeTracing,
    userBoundingBoxes,
  }));

  const maybeSkeletonUpdater = state.tracing.skeleton ? { skeleton: updaterObject } : {};
  const maybeVolumeUpdater = { volumes: { $set: newVolumes } };
  const maybeReadOnlyUpdater = state.tracing.readOnly ? { readOnly: updaterObject } : {};
  return update(state, {
    tracing: {
      // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
      ...maybeSkeletonUpdater,
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

    case "EDIT_ANNOTATION_LAYER": {
      const newAnnotationLayers = state.tracing.annotationLayers.map(layer => {
        if (layer.tracingId !== action.tracingId) {
          return layer;
        } else {
          return {
            ...layer,
            ...action.layerProperties,
          };
        }
      });
      return updateTracing(state, {
        annotationLayers: newAnnotationLayers,
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

    case "CHANGE_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);
      if (tracing == null) {
        return state;
      }
      const updatedUserBoundingBoxes = tracing.userBoundingBoxes.map(bbox =>
        bbox.id === action.id
          ? {
              id: bbox.id,
              ...bbox,
              ...action.newProps,
            }
          : bbox,
      );
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
    }

    case "ADD_NEW_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);
      if (tracing == null) {
        return state;
      }
      const { userBoundingBoxes } = tracing;
      const highestBoundingBoxId = Math.max(0, ...userBoundingBoxes.map(bb => bb.id));
      const boundingBoxId = highestBoundingBoxId + 1;
      let newBoundingBox: UserBoundingBox;
      if (action.newBoundingBox != null) {
        newBoundingBox = ({ id: boundingBoxId, ...action.newBoundingBox }: UserBoundingBox);
      } else {
        const { min, max, halfBoxExtent } = getDisplayedDataExtentInPlaneMode(state);
        newBoundingBox = {
          boundingBox: { min, max },
          id: boundingBoxId,
          name: `Bounding box ${boundingBoxId}`,
          color: Utils.getRandomColor(),
          isVisible: true,
        };
        if (action.center != null) {
          newBoundingBox.boundingBox = {
            min: V3.toArray(V3.round(V3.sub(action.center, halfBoxExtent))),
            max: V3.toArray(V3.round(V3.add(action.center, halfBoxExtent))),
          };
        }
      }
      const updatedUserBoundingBoxes = [...userBoundingBoxes, newBoundingBox];
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
    }

    case "ADD_USER_BOUNDING_BOXES": {
      const tracing = maybeGetSomeTracing(state.tracing);
      if (tracing == null) {
        return state;
      }
      const highestBoundingBoxId = Math.max(0, ...tracing.userBoundingBoxes.map(bb => bb.id));
      const additionalUserBoundingBoxes = action.userBoundingBoxes.map((bb, index) => ({
        ...bb,
        id: highestBoundingBoxId + index + 1,
      }));
      const mergedUserBoundingBoxes = [
        ...tracing.userBoundingBoxes,
        ...additionalUserBoundingBoxes,
      ];
      return updateUserBoundingBoxes(state, mergedUserBoundingBoxes);
    }

    case "DELETE_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);
      if (tracing == null) {
        return state;
      }
      const updatedUserBoundingBoxes = tracing.userBoundingBoxes.filter(
        bbox => bbox.id !== action.id,
      );
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
    }

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
      const isosurfaceInfo: WriteableShape<IsosurfaceInformation> = { isVisible: visibility };
      return updateKey4(
        state,
        "localSegmentationData",
        layerName,
        "isosurfaces",
        // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
        id,
        isosurfaceInfo,
      );
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

      const { [cellId]: _, ...remainingIsosurfaces } = state.localSegmentationData[
        layerName
      ].isosurfaces;

      return updateKey2(state, "localSegmentationData", layerName, {
        isosurfaces: remainingIsosurfaces,
      });
    }

    case "ADD_AD_HOC_ISOSURFACE": {
      const { layerName, cellId, seedPosition, mappingName, mappingType } = action;
      const isosurfaceInfo: IsosurfaceInformation = {
        segmentId: cellId,
        seedPosition,
        isLoading: false,
        isVisible: true,
        isPrecomputed: false,
        mappingName,
        mappingType,
      };

      return updateKey4(
        state,
        "localSegmentationData",
        layerName,
        "isosurfaces",
        // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
        cellId,
        // $FlowIgnore[incompatible-call]
        // $FlowIgnore[prop-missing] updateKey has problems with union types
        isosurfaceInfo,
      );
    }
    case "ADD_PRECOMPUTED_ISOSURFACE": {
      const { layerName, cellId, seedPosition, meshFileName } = action;
      const isosurfaceInfo: IsosurfaceInformation = {
        segmentId: cellId,
        seedPosition,
        isLoading: false,
        isVisible: true,
        isPrecomputed: true,
        meshFileName,
      };

      return updateKey4(
        state,
        "localSegmentationData",
        layerName,
        "isosurfaces",
        // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
        cellId,
        // $FlowIgnore[incompatible-call]
        // $FlowIgnore[prop-missing] updateKey has problems with union types
        isosurfaceInfo,
      );
    }

    case "STARTED_LOADING_ISOSURFACE": {
      const { layerName, cellId } = action;
      const isosurfaceInfo: WriteableShape<IsosurfaceInformation> = { isLoading: true };
      return updateKey4(
        state,
        "localSegmentationData",
        layerName,
        "isosurfaces",
        // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
        cellId,
        isosurfaceInfo,
      );
    }

    case "FINISHED_LOADING_ISOSURFACE": {
      const { layerName, cellId } = action;
      const isosurfaceInfo: WriteableShape<IsosurfaceInformation> = { isLoading: false };
      return updateKey4(
        state,
        "localSegmentationData",
        layerName,
        "isosurfaces",
        // $FlowIgnore[incompatible-call] updateKey has problems with updating Objects as Dictionaries
        cellId,
        isosurfaceInfo,
      );
    }

    case "UPDATE_MESH_FILE_LIST": {
      const { layerName, meshFiles } = action;
      return updateKey2(state, "localSegmentationData", layerName, {
        availableMeshFiles: meshFiles,
      });
    }

    case "UPDATE_CURRENT_MESH_FILE": {
      const { layerName, meshFileName } = action;
      const availableMeshFiles = state.localSegmentationData[layerName].availableMeshFiles;
      if (availableMeshFiles == null) return state;

      const meshFile = availableMeshFiles.find(el => el.meshFileName === meshFileName);
      return updateKey2(state, "localSegmentationData", layerName, { currentMeshFile: meshFile });
    }

    default:
      return state;
  }
}

export default AnnotationReducer;
