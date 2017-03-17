// @flow
import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { FlycamActionType } from "oxalis/model/actions/flycam_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getMaxZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";
import Utils from "libs/utils";
import Dimensions from "oxalis/model/dimensions";
import _ from "lodash";

const ZOOM_STEP_INTERVAL = 1.1;
const ZOOM_STEP_MIN = 0.1;

function cloneMatrix(m: Matrix4x4): Matrix4x4 {
  return [
    m[0], m[1], m[2], m[3],
    m[4], m[5], m[6], m[7],
    m[8], m[9], m[10], m[11],
    m[12], m[13], m[14], m[15],
  ];
}

function rotateOnAxis(currentMatrix: Matrix4x4, angle: number, axis: Vector3): Matrix4x4 {
  return M4x4.rotate(angle, axis, currentMatrix, []);
}

function rotateOnAxisWithDistance(
  zoomStep: number, distance: number,
  currentMatrix: Matrix4x4, angle: number, axis: Vector3,
): Matrix4x4 {
  const distanceVecNegative = [0, 0, -zoomStep * distance];
  const distanceVecPositive = [0, 0, zoomStep * distance];

  let matrix = M4x4.translate(distanceVecNegative, currentMatrix, []);
  matrix = rotateOnAxis(matrix, angle, axis);
  return M4x4.translate(distanceVecPositive, matrix, []);
}

function rotateReducer(state: OxalisState, angle: number, axis: Vector3, regardDistance: boolean): OxalisState {
  const { flycam } = state;
  if (regardDistance) {
    return update(state, { flycam: {
      currentMatrix: { $set: rotateOnAxisWithDistance(
        flycam.zoomStep,
        state.userConfiguration.sphericalCapRadius,
        flycam.currentMatrix,
        angle,
        axis,
      ) },
    } });
  }
  return update(state, { flycam: {
    currentMatrix: { $set: rotateOnAxis(flycam.currentMatrix, angle, axis) },
  } });
}

function getMatrixScale(dataSetScale: Vector3): Vector3 {
  const scale = [1 / dataSetScale[0], 1 / dataSetScale[1], 1 / dataSetScale[2]];
  const maxScale = Math.max(scale[0], scale[1], scale[2]);
  const multi = 1 / maxScale;
  return [multi * scale[0], multi * scale[1], multi * scale[2]];
}

function resetMatrix(matrix: Matrix4x4, dataSetScale: Vector3) {
  const scale = getMatrixScale(dataSetScale);
  // Save position
  const position = [matrix[12], matrix[13], matrix[14]];
  // Reset rotation
  const newMatrix = rotateOnAxis(M4x4.scale(scale, M4x4.identity, []), Math.PI, [0, 0, 1]);
  // Restore position
  newMatrix[12] = position[0];
  newMatrix[13] = position[1];
  newMatrix[14] = position[2];
  return newMatrix;
}

function moveReducer(state: OxalisState, vector: Vector3): OxalisState {
  const matrix = cloneMatrix(state.flycam.currentMatrix);
  matrix[12] += vector[0];
  matrix[13] += vector[1];
  matrix[14] += vector[2];
  return update(state, { flycam: { currentMatrix: { $set: matrix } } });
}

function zoomReducer(state: OxalisState, zoomStep: number): OxalisState {
  return update(state, { flycam: {
    zoomStep: { $set: Utils.clamp(ZOOM_STEP_MIN, zoomStep, getMaxZoomStep(state)) },
  } });
}

function FlycamReducer(state: OxalisState, action: ActionWithTimestamp<FlycamActionType | SettingActionType>): OxalisState {
  switch (action.type) {
    case "SET_DATASET": {
      return update(state, { flycam: {
        currentMatrix: { $set: resetMatrix(state.flycam.currentMatrix, action.dataset.scale) },
      } });
    }

    case "ZOOM_IN":
      return zoomReducer(state, state.flycam.zoomStep / ZOOM_STEP_INTERVAL);

    case "ZOOM_OUT":
      return zoomReducer(state, state.flycam.zoomStep * ZOOM_STEP_INTERVAL);

    case "ZOOM_BY_DELTA":
      return zoomReducer(state, state.flycam.zoomStep / Math.pow(ZOOM_STEP_INTERVAL, action.zoomDelta));

    case "SET_ZOOM_STEP":
      return zoomReducer(state, action.zoomStep);

    case "SET_POSITION": {
      // cannot use M4x4.clone because of immutable-seamless
      const matrix = cloneMatrix(state.flycam.currentMatrix);
      if (action.position[0] != null) {
        matrix[12] = action.position[0];
      }
      if (action.position[1] != null) {
        matrix[13] = action.position[1];
      }
      if (action.position[2] != null) {
        matrix[14] = action.position[2];
      }
      return update(state, { flycam: { currentMatrix: { $set: matrix } } });
    }

    case "SET_ROTATION": {
      if (state.dataset != null) {
        const [x, y, z] = action.rotation;
        let matrix = resetMatrix(state.flycam.currentMatrix, state.dataset.scale);
        matrix = rotateOnAxis(matrix, (-z * Math.PI) / 180, [0, 0, 1]);
        matrix = rotateOnAxis(matrix, (-y * Math.PI) / 180, [0, 1, 0]);
        matrix = rotateOnAxis(matrix, (-x * Math.PI) / 180, [1, 0, 0]);
        let newState = update(state, { flycam: { currentMatrix: { $set: matrix } } });
        if (state.userConfiguration.dynamicSpaceDirection) {
          const spaceDirectionOrtho = [0, 1, 2].map(index => action.rotation[index] < 0 ? -1 : 1);
          newState = update(newState, { flycam: { spaceDirectionOrtho: { $set: spaceDirectionOrtho } } });
        }
        return newState;
      }
      return state;
    }

    case "MOVE_FLYCAM":
      return update(state, { flycam: {
        currentMatrix: { $set: M4x4.translate(action.vector, state.flycam.currentMatrix, []) },
      } });

    case "MOVE_FLYCAM_ORTHO": {
      const vector = _.clone(action.vector);
      const { planeId } = action;
      // if planeID is given, use it to manipulate z
      if (planeId != null && state.userConfiguration.dynamicSpaceDirection) {
        // change direction of the value connected to space, based on the last direction
        const dim = Dimensions.getIndices(planeId)[2];
        vector[dim] *= state.flycam.spaceDirectionOrtho[dim];
      }
      return moveReducer(state, vector);
    }

    case "MOVE_PLANE_FLYCAM_ORTHO": {
      const { dataset } = state;
      if (dataset != null) {
        const { planeId, increaseSpeedWithZoom } = action;
        const vector = Dimensions.transDim(action.vector, planeId);
        const zoomFactor = increaseSpeedWithZoom ? state.flycam.zoomStep : 1;
        const scaleFactor = getBaseVoxelFactors(dataset.scale);
        const delta = [
          vector[0] * zoomFactor * scaleFactor[0],
          vector[1] * zoomFactor * scaleFactor[1],
          vector[2] * zoomFactor * scaleFactor[2],
        ];

        if (planeId != null && state.userConfiguration.dynamicSpaceDirection) {
          // change direction of the value connected to space, based on the last direction
          const dim = Dimensions.getIndices(planeId)[2];
          delta[dim] *= state.flycam.spaceDirectionOrtho[dim];
        }

        return moveReducer(state, delta);
      }
      return state;
    }

    case "YAW_FLYCAM":
      return rotateReducer(state, action.angle, [0, 1, 0], action.regardDistance);

    case "ROLL_FLYCAM":
      return rotateReducer(state, action.angle, [0, 0, 1], action.regardDistance);

    case "PITCH_FLYCAM":
      return rotateReducer(state, action.angle, [1, 0, 0], action.regardDistance);

    case "ROTATE_FLYCAM":
      return rotateReducer(state, action.angle, action.axis, action.regardDistance);

    default:
      return state;
  }
}

export default FlycamReducer;
