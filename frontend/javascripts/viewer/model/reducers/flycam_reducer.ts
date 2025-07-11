import update from "immutability-helper";
import type { Matrix4x4 } from "libs/mjs";
import { M4x4, V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import _ from "lodash";
import * as THREE from "three";
import type { Vector3 } from "viewer/constants";
import {
  ZOOM_STEP_INTERVAL,
  getRotationInDegrees,
  getRotationInRadian,
  getValidZoomRangeForUser,
} from "viewer/model/accessors/flycam_accessor";
import type { Action } from "viewer/model/actions/actions";
import Dimensions from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import type { WebknossosState } from "viewer/store";
import { getUnifiedAdditionalCoordinates } from "../accessors/dataset_accessor";

function cloneMatrix(m: Matrix4x4): Matrix4x4 {
  return [
    m[0],
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
    m[7],
    m[8],
    m[9],
    m[10],
    m[11],
    m[12],
    m[13],
    m[14],
    m[15],
  ];
}

export function rotateOnAxis(currentMatrix: Matrix4x4, angle: number, axis: Vector3): Matrix4x4 {
  return M4x4.rotate(angle, axis, currentMatrix, []);
}

// Avoid creating new THREE object for some actions.
const flycamRotationEuler = new THREE.Euler();
const flycamRotationMatrix = new THREE.Matrix4();
const deltaInWorld = new THREE.Vector3();

function rotateOnAxisWithDistance(
  zoomStep: number,
  distance: number,
  currentMatrix: Matrix4x4,
  angle: number,
  axis: Vector3,
): Matrix4x4 {
  const distanceVecNegative: Vector3 = [0, 0, -zoomStep * distance];
  const distanceVecPositive: Vector3 = [0, 0, zoomStep * distance];
  let matrix = M4x4.translate(distanceVecNegative, currentMatrix, []);
  matrix = rotateOnAxis(matrix, angle, axis);
  return M4x4.translate(distanceVecPositive, matrix, []);
}

function keepRotationInBounds(rotation: Vector3): Vector3 {
  const rotationInBounds = Utils.map3((v) => Utils.mod(Math.round(v), 360), rotation);
  return rotationInBounds;
}

function rotateReducer(
  state: WebknossosState,
  angle: number,
  axis: Vector3,
  regardDistance: boolean,
): WebknossosState {
  if (Number.isNaN(angle)) {
    return state;
  }

  const { flycam } = state;
  const updatedMatrix = regardDistance
    ? rotateOnAxisWithDistance(
        flycam.zoomStep,
        state.userConfiguration.sphericalCapRadius,
        flycam.currentMatrix,
        angle,
        axis,
      )
    : rotateOnAxis(flycam.currentMatrix, angle, axis);
  const updatedRotation = getRotationInDegrees(updatedMatrix);

  return update(state, {
    flycam: {
      currentMatrix: {
        $set: updatedMatrix,
      },
      rotation: {
        $set: keepRotationInBounds(updatedRotation),
      },
    },
  });
}

export function getMatrixScale(voxelSize: Vector3): Vector3 {
  const scale = [1 / voxelSize[0], 1 / voxelSize[1], 1 / voxelSize[2]];
  const maxScale = Math.max(scale[0], scale[1], scale[2]);
  const multi = 1 / maxScale;
  return [multi * scale[0], multi * scale[1], multi * scale[2]];
}

function resetMatrix(matrix: Matrix4x4, voxelSize: Vector3) {
  const scale = getMatrixScale(voxelSize);
  // Save position
  const position = [matrix[12], matrix[13], matrix[14]];
  // Reset rotation. The default rotation of 180 degree around z is applied.
  const newMatrix = rotateOnAxis(M4x4.scale(scale, M4x4.identity(), []), Math.PI, [0, 0, 1]);
  // Restore position
  newMatrix[12] = position[0];
  newMatrix[13] = position[1];
  newMatrix[14] = position[2];
  return newMatrix;
}

function moveReducer(state: WebknossosState, vector: Vector3): WebknossosState {
  const matrix = cloneMatrix(state.flycam.currentMatrix);

  if (!vector.includes(Number.NaN)) {
    matrix[12] += vector[0];
    matrix[13] += vector[1];
    matrix[14] += vector[2];
  }

  return update(state, {
    flycam: {
      currentMatrix: {
        $set: matrix,
      },
    },
  });
}

export function zoomReducer(state: WebknossosState, zoomStep: number): WebknossosState {
  const [min, max] = getValidZoomRangeForUser(state);
  let newZoomStep = Utils.clamp(min, zoomStep, max);

  if (isNaN(newZoomStep)) {
    newZoomStep = 1;
  }

  const newState = update(state, {
    flycam: {
      zoomStep: {
        $set: newZoomStep,
      },
    },
  });
  return newState;
}
export function setDirectionReducer(state: WebknossosState, direction: Vector3) {
  const previousSpaceDirectionOrtho = state.flycam.spaceDirectionOrtho;
  const spaceDirectionOrtho = Utils.map3((el, index) => {
    if (el === 0) {
      return previousSpaceDirectionOrtho[index];
    }

    return el < 0 ? -1 : 1;
  }, direction);
  return update(state, {
    flycam: {
      direction: {
        $set: direction,
      },
      spaceDirectionOrtho: {
        $set: spaceDirectionOrtho,
      },
    },
  });
}

// The way rotations are currently handled / interpreted is quirky. See here for more information:
// https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c63800fb874e717e49da7bc
export function setRotationReducer(state: WebknossosState, rotation: Vector3) {
  if (state.dataset != null) {
    const [x, y, z] = rotation;
    let matrix = resetMatrix(state.flycam.currentMatrix, state.dataset.dataSource.scale.factor);
    matrix = rotateOnAxis(matrix, (-z * Math.PI) / 180, [0, 0, 1]);
    matrix = rotateOnAxis(matrix, (-y * Math.PI) / 180, [0, 1, 0]);
    matrix = rotateOnAxis(matrix, (-x * Math.PI) / 180, [1, 0, 0]);
    return update(state, {
      flycam: {
        currentMatrix: {
          $set: matrix,
        },
        rotation: {
          $set: keepRotationInBounds(rotation),
        },
      },
    });
  }

  return state;
}

function FlycamReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_DATASET": {
      return update(state, {
        flycam: {
          currentMatrix: {
            $set: resetMatrix(state.flycam.currentMatrix, action.dataset.dataSource.scale.factor),
          },
          rotation: {
            $set: [0, 0, 0],
          },
        },
      });
    }

    case "ZOOM_IN":
      return zoomReducer(state, state.flycam.zoomStep / ZOOM_STEP_INTERVAL);

    case "ZOOM_OUT":
      return zoomReducer(state, state.flycam.zoomStep * ZOOM_STEP_INTERVAL);

    case "ZOOM_BY_DELTA":
      return zoomReducer(
        state,
        state.flycam.zoomStep / Math.pow(ZOOM_STEP_INTERVAL, action.zoomDelta),
      );

    case "SET_ZOOM_STEP":
      return zoomReducer(state, action.zoomStep);

    case "SET_POSITION": {
      // cannot use M4x4.clone because of immutable-seamless
      const matrix = cloneMatrix(state.flycam.currentMatrix);
      const { position } = action;

      if (action.dimensionToSkip !== 0 && !isNaN(position[0])) {
        matrix[12] = action.position[0];
      }

      if (action.dimensionToSkip !== 1 && !isNaN(position[1])) {
        matrix[13] = action.position[1];
      }

      if (action.dimensionToSkip !== 2 && !isNaN(position[2])) {
        matrix[14] = action.position[2];
      }

      return update(state, {
        flycam: {
          currentMatrix: {
            $set: matrix,
          },
        },
      });
    }

    case "SET_ADDITIONAL_COORDINATES": {
      const unifiedAdditionalCoordinates = getUnifiedAdditionalCoordinates(state.dataset);

      // In case the specified additional coordinates don't cover all existing additional
      // coordinates, add the missing coordinates back.
      // This *should* not happen, but in case of a bug somewhere, it's better to guard
      // against this here (for example, if a skeleton node doesn't have the necessary
      // additional coordinates, the UI shouldn't forget about the other additional
      // coordinates).
      let { values } = action;

      const existingAdditionalCoordinates = state.flycam.additionalCoordinates;
      values = Utils.values(unifiedAdditionalCoordinates).map(({ name, bounds }, index) => {
        const fallbackValue =
          (existingAdditionalCoordinates != null
            ? existingAdditionalCoordinates[index]?.value
            : null) ?? bounds[0];
        if (values) {
          const specifiedValue = values.find((element) => element.name === name);
          if (specifiedValue) {
            return {
              name,
              value: Utils.clamp(bounds[0], specifiedValue.value, bounds[1]),
            };
          }
        }
        return { name, value: fallbackValue };
      });

      return update(state, {
        flycam: {
          additionalCoordinates: { $set: values },
        },
      });
    }

    case "SET_ROTATION": {
      return setRotationReducer(state, action.rotation);
    }

    case "SET_DIRECTION": {
      return setDirectionReducer(state, action.direction);
    }

    case "MOVE_FLYCAM": {
      if (action.vector.includes(Number.NaN)) {
        // if the action vector is invalid, do not update
        return state;
      }

      const newMatrix = M4x4.translate(action.vector, state.flycam.currentMatrix, []);
      return update(state, {
        flycam: {
          currentMatrix: {
            $set: newMatrix,
          },
        },
      });
    }

    case "MOVE_FLYCAM_ORTHO": {
      const vector = _.clone(action.vector);

      const { planeId } = action;

      const flycamRotation = getRotationInRadian(state.flycam);
      flycamRotationMatrix.makeRotationFromEuler(flycamRotationEuler.set(...flycamRotation, "ZYX"));
      let deltaInWorldV3 = deltaInWorld
        .set(...vector)
        .applyMatrix4(flycamRotationMatrix)
        .toArray();

      // if planeID is given, use it to manipulate z
      if (planeId != null && state.userConfiguration.dynamicSpaceDirection) {
        // change direction of the value connected to space, based on the last direction
        deltaInWorldV3 = V3.multiply(deltaInWorldV3, state.flycam.spaceDirectionOrtho);
      }

      return moveReducer(state, deltaInWorldV3);
    }

    case "MOVE_PLANE_FLYCAM_ORTHO": {
      const { dataset, flycam } = state;

      if (dataset != null) {
        const { planeId, increaseSpeedWithZoom } = action;
        const vector = Dimensions.transDim(action.vector, planeId);
        const flycamRotation = getRotationInRadian(flycam);

        flycamRotationMatrix.makeRotationFromEuler(
          flycamRotationEuler.set(...flycamRotation, "ZYX"),
        );
        deltaInWorld.set(...vector).applyMatrix4(flycamRotationMatrix);
        const zoomFactor = increaseSpeedWithZoom ? flycam.zoomStep : 1;
        const scaleFactor = getBaseVoxelFactorsInUnit(dataset.dataSource.scale);
        let deltaInWorldZoomed = V3.multiply(
          V3.scale(deltaInWorld.toArray(), zoomFactor),
          scaleFactor,
        );

        if (planeId != null && state.userConfiguration.dynamicSpaceDirection) {
          // change direction of the value connected to space, based on the last direction
          deltaInWorldZoomed = V3.multiply(deltaInWorldZoomed, state.flycam.spaceDirectionOrtho);
        }

        return moveReducer(state, deltaInWorldZoomed);
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
