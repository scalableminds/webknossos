// @flow

import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import {
  type StateShape1,
  updateKey,
  updateKey2,
  updateKey3,
} from "oxalis/model/helpers/deep_update";
import { convertServerAnnotationToFrontendAnnotation } from "oxalis/model/reducers/reducer_helpers";

const updateTracing = (state: OxalisState, shape: StateShape1<"tracing">): OxalisState =>
  updateKey(state, "tracing", shape);

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

    case "SET_ANNOTATION_PUBLIC": {
      const { isPublic } = action;
      return updateTracing(state, {
        isPublic,
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

    case "SET_USER_BOUNDING_BOX": {
      const updaterObject = {
        userBoundingBox: {
          $set: action.userBoundingBox,
        },
      };
      const maybeSkeletonUpdater = state.tracing.skeleton ? { skeleton: updaterObject } : {};
      const maybeVolumeUpdater = state.tracing.volume ? { volume: updaterObject } : {};
      const maybeReadOnlyUpdater = state.tracing.readOnly ? { readOnly: updaterObject } : {};
      return update(state, {
        tracing: {
          ...maybeSkeletonUpdater,
          ...maybeVolumeUpdater,
          ...maybeReadOnlyUpdater,
        },
      });
    }

    case "UPDATE_MESH_METADATA": {
      const newMeshes = state.tracing.annotation.meshes.map(mesh => {
        if (mesh.id === action.id) {
          return { ...mesh };
        } else {
          return mesh;
        }
      });
      return updateKey3(state, "tracing", "annotation", "meshes", newMeshes);
    }

    default:
      return state;
  }
}

export default AnnotationReducer;
