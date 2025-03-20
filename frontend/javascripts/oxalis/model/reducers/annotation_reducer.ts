import update from "immutability-helper";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import _ from "lodash";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getDisplayedDataExtentInPlaneMode } from "oxalis/model/accessors/view_mode_accessor";
import type { Action } from "oxalis/model/actions/actions";
import { updateKey, updateKey2 } from "oxalis/model/helpers/deep_update";
import type { MeshInformation, OxalisState, UserBoundingBox } from "oxalis/store";
import type { AdditionalCoordinate } from "types/api_flow_types";
import { getDatasetBoundingBox } from "../accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "../accessors/flycam_accessor";
import { getMeshesForAdditionalCoordinates } from "../accessors/volumetracing_accessor";
import BoundingBox from "../bucket_data_handling/bounding_box";

const updateTracing = (state: OxalisState, shape: Partial<OxalisState["tracing"]>): OxalisState =>
  updateKey(state, "tracing", shape);

const updateUserBoundingBoxes = (state: OxalisState, userBoundingBoxes: Array<UserBoundingBox>) => {
  const updaterObject = {
    userBoundingBoxes: {
      $set: userBoundingBoxes,
    },
  };
  // We mirror/sync the user bounding boxes between all tracing objects.
  const newVolumes = state.tracing.volumes.map((volumeTracing) => ({
    ...volumeTracing,
    userBoundingBoxes,
  }));
  const maybeSkeletonUpdater = state.tracing.skeleton
    ? {
        skeleton: updaterObject,
      }
    : {};
  const maybeVolumeUpdater = {
    volumes: {
      $set: newVolumes,
    },
  };
  const maybeReadOnlyUpdater = state.tracing.readOnly
    ? {
        readOnly: updaterObject,
      }
    : {};
  return update(state, {
    tracing: {
      ...maybeSkeletonUpdater,
      ...maybeVolumeUpdater,
      ...maybeReadOnlyUpdater,
    },
  });
};

const maybeAddAdditionalCoordinatesToMeshState = (
  state: OxalisState,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  layerName: string,
) => {
  if (getMeshesForAdditionalCoordinates(state, additionalCoordinates, layerName) == null) {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    return update(state, {
      localSegmentationData: {
        [layerName]: {
          meshes: {
            [additionalCoordKey]: { $set: [] },
          },
        },
      },
    });
  }
  return state;
};

function AnnotationReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "INITIALIZE_ANNOTATION": {
      return updateTracing(state, {
        // Clear all tracings. These will be initialized in corresponding
        // initialization actions.
        mappings: [],
        skeleton: undefined,
        volumes: [],
        ...action.annotation,
      });
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
      const newAnnotationLayers = state.tracing.annotationLayers.map((layer) => {
        if (layer.tracingId !== action.tracingId) {
          return layer;
        } else {
          return { ...layer, ...action.layerProperties };
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
      return updateKey2(state, "tracing", "restrictions", {
        allowUpdate,
      });
    }

    case "SET_BLOCKED_BY_USER": {
      const { blockedByUser } = action;
      return updateKey(state, "tracing", {
        blockedByUser,
      });
    }

    case "SET_USER_BOUNDING_BOXES": {
      return updateUserBoundingBoxes(state, action.userBoundingBoxes);
    }

    case "CHANGE_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);

      if (tracing == null) {
        return state;
      }

      const updatedUserBoundingBoxes = tracing.userBoundingBoxes.map((bbox) =>
        bbox.id === action.id
          ? {
              // @ts-expect-error ts-migrate(2783) FIXME: 'id' is specified more than once, so this usage wi... Remove this comment to see the full error message
              id: bbox.id,
              ...bbox,
              ...action.newProps,
            }
          : bbox,
      );
      const updatedState = updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
      return updateKey(updatedState, "uiInformation", {
        activeUserBoundingBoxId: action.id,
      });
    }

    case "ADD_NEW_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);

      if (tracing == null) {
        return state;
      }

      const { userBoundingBoxes } = tracing;
      const highestBoundingBoxId = Math.max(0, ...userBoundingBoxes.map((bb) => bb.id));
      const boundingBoxId = highestBoundingBoxId + 1;

      const { min, max, halfBoxExtent } = getDisplayedDataExtentInPlaneMode(state);
      const newBoundingBoxTemplate: UserBoundingBox = {
        boundingBox: {
          min,
          max,
        },
        id: boundingBoxId,
        name: `Bounding box ${boundingBoxId}`,
        color: Utils.getRandomColor(),
        isVisible: true,
      };

      if (action.center != null) {
        newBoundingBoxTemplate.boundingBox = {
          min: V3.toArray(V3.round(V3.sub(action.center, halfBoxExtent))),
          max: V3.toArray(V3.round(V3.add(action.center, halfBoxExtent))),
        };
      }
      let newUserBoundingBox: UserBoundingBox;
      if (action.newBoundingBox != null) {
        newUserBoundingBox = {
          ...newBoundingBoxTemplate,
          ...action.newBoundingBox,
        };
      } else {
        newUserBoundingBox = newBoundingBoxTemplate;
      }

      // Ensure the new bounding box is within the dataset bounding box.
      const datasetBoundingBox = getDatasetBoundingBox(state.dataset);
      const newBoundingBox = new BoundingBox(newUserBoundingBox.boundingBox);
      const newBoundingBoxWithinDataset = newBoundingBox.intersectedWith(datasetBoundingBox);
      // Only update the bounding box if the bounding box overlaps with the dataset bounds.
      // Else the bounding box is completely outside the dataset bounds -> in that case just keep the bounding box and let the user cook.
      if (newBoundingBoxWithinDataset.getVolume() > 0) {
        newUserBoundingBox.boundingBox = newBoundingBoxWithinDataset.toBoundingBoxType();
      }

      const updatedUserBoundingBoxes = [...userBoundingBoxes, newUserBoundingBox];
      const updatedState = updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
      return updateKey(updatedState, "uiInformation", {
        activeUserBoundingBoxId: newUserBoundingBox.id,
      });
    }

    case "ADD_USER_BOUNDING_BOXES": {
      const tracing = maybeGetSomeTracing(state.tracing);

      if (tracing == null) {
        return state;
      }

      const highestBoundingBoxId = Math.max(0, ...tracing.userBoundingBoxes.map((bb) => bb.id));
      const additionalUserBoundingBoxes = action.userBoundingBoxes.map((bb, index) => ({
        ...bb,
        id: highestBoundingBoxId + index + 1,
      }));
      const mergedUserBoundingBoxes = _.uniqWith(
        [...tracing.userBoundingBoxes, ...additionalUserBoundingBoxes],
        (bboxWithId1, bboxWithId2) => {
          const { id: _id1, ...bbox1 } = bboxWithId1;
          const { id: _id2, ...bbox2 } = bboxWithId2;
          return _.isEqual(bbox1, bbox2);
        },
      );
      return updateUserBoundingBoxes(state, mergedUserBoundingBoxes);
    }

    case "DELETE_USER_BOUNDING_BOX": {
      const tracing = maybeGetSomeTracing(state.tracing);

      if (tracing == null) {
        return state;
      }

      const updatedUserBoundingBoxes = tracing.userBoundingBoxes.filter(
        (bbox) => bbox.id !== action.id,
      );
      const updatedState = updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
      if (action.id === state.uiInformation.activeUserBoundingBoxId) {
        return updateKey(updatedState, "uiInformation", {
          activeUserBoundingBoxId: null,
        });
      }
      return updatedState;
    }

    case "UPDATE_MESH_VISIBILITY": {
      const { layerName, id, visibility, additionalCoordinates } = action;
      const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [additionalCoordKey]: {
                [id]: {
                  isVisible: {
                    $set: visibility,
                  },
                },
              },
            },
          },
        },
      });
    }

    case "REMOVE_MESH": {
      const { layerName, segmentId } = action;
      const newMeshes: Record<string, Record<number, MeshInformation>> = {};
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
      const maybeMeshes = getMeshesForAdditionalCoordinates(
        state,
        additionalCoordinates,
        layerName,
      );
      if (maybeMeshes == null || maybeMeshes[segmentId] == null) {
        // No meshes exist for the segment id. No need to do anything.
        return state;
      }
      const { [segmentId]: _, ...remainingMeshes } = maybeMeshes as Record<number, MeshInformation>;
      newMeshes[additionalCoordKey] = remainingMeshes;
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              $merge: newMeshes,
            },
          },
        },
      });
    }

    // Mesh information is stored in three places: the state in the store, segment_view_controller and within the mesh_saga.
    case "ADD_AD_HOC_MESH": {
      const {
        layerName,
        segmentId,
        seedPosition,
        seedAdditionalCoordinates,
        mappingName,
        mappingType,
      } = action;
      const meshInfo: MeshInformation = {
        segmentId: segmentId,
        seedPosition,
        seedAdditionalCoordinates,
        isLoading: false,
        isVisible: true,
        isPrecomputed: false,
        mappingName,
        mappingType,
      };
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);

      const stateWithCurrentAddCoords = maybeAddAdditionalCoordinatesToMeshState(
        state,
        additionalCoordinates,
        layerName,
      );

      const updatedKey = update(stateWithCurrentAddCoords, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [additionalCoordKey]: {
                [segmentId]: {
                  $set: meshInfo,
                },
              },
            },
          },
        },
      });
      return updatedKey;
    }

    case "ADD_PRECOMPUTED_MESH": {
      const {
        layerName,
        segmentId,
        seedPosition,
        seedAdditionalCoordinates,
        meshFileName,
        areChunksMerged,
        mappingName,
      } = action;
      const meshInfo: MeshInformation = {
        segmentId: segmentId,
        seedPosition,
        seedAdditionalCoordinates,
        isLoading: false,
        isVisible: true,
        isPrecomputed: true,
        meshFileName,
        areChunksMerged,
        mappingName,
      };
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);

      const stateWithCurrentAddCoords = maybeAddAdditionalCoordinatesToMeshState(
        state,
        additionalCoordinates,
        layerName,
      );
      const updatedKey = update(stateWithCurrentAddCoords, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [additionalCoordKey]: {
                [segmentId]: {
                  $set: meshInfo,
                },
              },
            },
          },
        },
      });
      return updatedKey;
    }

    case "STARTED_LOADING_MESH": {
      const { layerName, segmentId } = action;
      const additionalCoordKey = getAdditionalCoordinatesAsString(
        state.flycam.additionalCoordinates,
      );
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [additionalCoordKey]: {
                [segmentId]: {
                  isLoading: {
                    $set: true,
                  },
                },
              },
            },
          },
        },
      });
      return updatedKey;
    }

    case "FINISHED_LOADING_MESH": {
      const { layerName, segmentId } = action;
      const additionalCoordKey = getAdditionalCoordinatesAsString(
        state.flycam.additionalCoordinates,
      );
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [additionalCoordKey]: {
                [segmentId]: {
                  isLoading: {
                    $set: false,
                  },
                },
              },
            },
          },
        },
      });
      return updatedKey;
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
      const meshFile = availableMeshFiles.find((el) => el.meshFileName === meshFileName);
      return updateKey2(state, "localSegmentationData", layerName, {
        currentMeshFile: meshFile,
      });
    }

    case "SET_SELECTED_SEGMENTS_OR_GROUP": {
      const { selectedSegments, selectedGroup, layerName } = action;
      return updateKey2(state, "localSegmentationData", layerName, {
        selectedIds: { segments: selectedSegments, group: selectedGroup },
      });
    }

    case "SET_OTHERS_MAY_EDIT_FOR_ANNOTATION": {
      return updateKey(state, "tracing", {
        othersMayEdit: action.othersMayEdit,
      });
    }

    default:
      return state;
  }
}

export default AnnotationReducer;
