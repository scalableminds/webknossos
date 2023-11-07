import update from "immutability-helper";
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, UserBoundingBox, MeshInformation } from "oxalis/store";
import { V3 } from "libs/mjs";
import { updateKey, updateKey2, updateKey3, updateKey4 } from "oxalis/model/helpers/deep_update";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import * as Utils from "libs/utils";
import { getDisplayedDataExtentInPlaneMode } from "oxalis/model/accessors/view_mode_accessor";
import { convertServerAnnotationToFrontendAnnotation } from "oxalis/model/reducers/reducer_helpers";
import _ from "lodash";

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
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
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
      let newBoundingBox: UserBoundingBox;
      if (action.newBoundingBox != null) {
        newBoundingBox = {
          ...newBoundingBoxTemplate,
          ...action.newBoundingBox,
        };
      } else {
        newBoundingBox = newBoundingBoxTemplate;
      }

      const updatedUserBoundingBoxes = [...userBoundingBoxes, newBoundingBox];
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
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
      return updateUserBoundingBoxes(state, updatedUserBoundingBoxes);
    }

    case "UPDATE_ISOSURFACE_VISIBILITY": {
      const { layerName, id, visibility, additionalCoordinates } = action;
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      // assumption: set_additional_coordinates action is handled before
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
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

    case "REMOVE_ISOSURFACE": {
      //TODO fix me
      const { layerName, segmentId } = action;
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      const { [segmentId]: _, ...remainingMeshes } =
        state.localSegmentationData[layerName].meshes[addCoordString];
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
                $set: remainingMeshes,
              },
            },
          },
        },
      });
    }

    case "ADD_AD_HOC_ISOSURFACE": {
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
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
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

    case "ADD_PRECOMPUTED_ISOSURFACE": {
      const { layerName, segmentId, seedPosition, meshFileName } = action;
      const meshInfo: MeshInformation = {
        segmentId: segmentId,
        seedPosition,
        isLoading: false,
        isVisible: true,
        isPrecomputed: true,
        meshFileName,
      };
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
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

    case "STARTED_LOADING_ISOSURFACE": {
      const { layerName, segmentId } = action;
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
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

    case "FINISHED_LOADING_ISOSURFACE": {
      const { layerName, segmentId } = action;
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const addCoordString =
        additionalCoordinates != null && additionalCoordinates?.length > 0
          ? `${additionalCoordinates[0].name}=${additionalCoordinates[0].value}`
          : "";
      const updatedKey = update(state, {
        localSegmentationData: {
          [layerName]: {
            meshes: {
              [addCoordString]: {
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
