// @flow
import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { Flycam3DActionType } from "oxalis/model/actions/flycam3d_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "libs/mjs";
import type { Vector3 } from "oxalis/constants";

const ZOOM_STEP_INTERVAL = 1.1;
const ZOOM_STEP_MIN = 0.5;
const ZOOM_STEP_MAX = 5;

function rotateOnAxis(currentMatrix: Matrix4x4, angle: number, axis: Vector3): Matrix4x4 {
  return M4x4.rotate(angle, axis, currentMatrix);
}

function rotateOnAxisWithDistance(
  zoomStep: number, distance: number,
  currentMatrix: Matrix4x4, angle: number, axis: Vector3,
): Matrix4x4 {
  const distanceVecNegative = [0, 0, -zoomStep * distance];
  const distanceVecPositive = [0, 0, zoomStep * distance];

  let matrix = M4x4.translate(distanceVecNegative, currentMatrix);
  matrix = rotateOnAxis(matrix, angle, axis);
  return M4x4.translate(distanceVecPositive, matrix);
}

function rotateReducer(state: OxalisState, angle: number, axis: Vector3, regardDistance: boolean): OxalisState {
  const { flycam3d } = state;
  if (regardDistance) {
    return update(state, { flycam3d: {
      currentMatrix: { $set: rotateOnAxisWithDistance(
        flycam3d.zoomStep,
        state.userConfiguration.sphericalCapRadius,
        flycam3d.currentMatrix,
        angle,
        axis,
      ) },
    } });
  }
  return update(state, { flycam3d: {
    currentMatrix: { $set: rotateOnAxis(flycam3d.currentMatrix, angle, axis) },
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
  const newMatrix = rotateOnAxis(M4x4.scale(scale, M4x4.identity), Math.PI, [0, 0, 1]);
  // Restore position
  newMatrix[12] = position[0];
  newMatrix[13] = position[1];
  newMatrix[14] = position[2];
  return newMatrix;
}


function Flycam3DReducer(state: OxalisState, action: ActionWithTimestamp<Flycam3DActionType | SettingActionType>): OxalisState {
  switch (action.type) {
    case "SET_DATASET": {
      return update(state, { flycam3d: {
        currentMatrix: { $set: resetMatrix(state.flycam3d.currentMatrix, action.dataset.scale) },
      } });
    }

    case "ZOOM_IN":
      return update(state, { flycam3d: {
        zoomStep: { $set: Math.max(state.flycam3d.zoomStep / ZOOM_STEP_INTERVAL, ZOOM_STEP_MIN) },
      } });

    case "ZOOM_OUT":
      return update(state, { flycam3d: {
        zoomStep: { $set: Math.min(state.flycam3d.zoomStep * ZOOM_STEP_INTERVAL, ZOOM_STEP_MAX) },
      } });

    case "SET_ZOOM_STEP":
      return update(state, { flycam3d: {
        zoomStep: { $set: Math.min(ZOOM_STEP_MAX, Math.max(ZOOM_STEP_MIN, action.zoomStep)) },
      } });

    case "SET_POSITION": {
      const matrix = M4x4.clone(state.flycam3d.currentMatrix);
      matrix[12] = action.position[0];
      matrix[13] = action.position[1];
      matrix[14] = action.position[2];
      return update(state, { flycam3d: { currentMatrix: { $set: matrix } } });
    }

    case "SET_ROTATION": {
      if (state.dataset != null) {
        const [x, y, z] = action.rotation;
        let matrix = resetMatrix(state.flycam3d.currentMatrix, state.dataset.scale);
        matrix = rotateOnAxis(matrix, (-z * Math.PI) / 180, [0, 0, 1]);
        matrix = rotateOnAxis(matrix, (-y * Math.PI) / 180, [0, 1, 0]);
        matrix = rotateOnAxis(matrix, (-x * Math.PI) / 180, [1, 0, 0]);
        return update(state, { flycam3d: { currentMatrix: { $set: matrix } } });
      }
      return state;
    }

    case "MOVE_FLYCAM":
      return update(state, { flycam3d: {
        currentMatrix: { $set: M4x4.translate(action.vector, state.flycam3d.currentMatrix) },
      } });

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

export default Flycam3DReducer;
