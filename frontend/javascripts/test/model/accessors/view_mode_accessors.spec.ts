import update from "immutability-helper";
import { describe, it, expect } from "vitest";
import type { WebknossosState } from "viewer/store";
import * as accessors from "viewer/model/accessors/view_mode_accessor";
import { OrthoViews, OrthoViewValuesWithoutTDView, UnitLong, type Vector3 } from "viewer/constants";
import defaultState from "viewer/default_state";
import { FlycamMatrixWithDefaultRotation } from "test/fixtures/flycam_object";
import { M4x4, V3 } from "libs/mjs";
import Dimensions from "viewer/model/dimensions";
import { setRotationAction } from "viewer/model/actions/flycam_actions";
import FlycamReducer from "viewer/model/reducers/flycam_reducer";
import { MathUtils, Vector3 as ThreeVector3, Euler } from "three";
import { map3 } from "libs/utils";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import { almostEqual } from "test/libs/transform_spec_helpers";
import testRotations from "test/fixtures/test_rotations";

const viewportOffsets = {
  left: 200,
  top: 20,
};
const viewportSize = 800;

const viewModeDataInputCatcher = {
  PLANE_XY: {
    left: viewportOffsets.left,
    top: viewportOffsets.top,
    width: viewportSize,
    height: viewportSize,
  },
  PLANE_YZ: {
    left: viewportOffsets.left + viewportSize,
    top: viewportOffsets.top,
    width: viewportSize,
    height: viewportSize,
  },
  PLANE_XZ: {
    left: viewportOffsets.left,
    top: viewportOffsets.top + viewportSize,
    width: viewportSize,
    height: viewportSize,
  },
  TDView: {
    left: viewportOffsets.left + viewportSize,
    top: viewportOffsets.top + viewportSize,
    width: viewportSize,
    height: viewportSize,
  },
};

const initialFlycamPosition = [100, 100, 100] as Vector3;

const initialState: WebknossosState = {
  ...defaultState,
  dataset: {
    ...defaultState.dataset,
    dataSource: {
      ...defaultState.dataset.dataSource,
      scale: { factor: [1, 1, 1], unit: UnitLong.nm },
    },
  },
  datasetConfiguration: { ...defaultState.datasetConfiguration },
  userConfiguration: {
    ...defaultState.userConfiguration,
    sphericalCapRadius: 100,
    dynamicSpaceDirection: true,
  },
  flycam: {
    ...defaultState.flycam,
    zoomStep: 1.0,
    // Flycam per default translated by initialFlycamPosition
    // and has the default rotation of 180°. For more see flycam_reducer.ts
    currentMatrix: M4x4.mul(
      M4x4.translate(initialFlycamPosition, M4x4.identity()),
      FlycamMatrixWithDefaultRotation,
    ),
    spaceDirectionOrtho: [1, 1, 1],
    rotation: [0, 0, 0],
  },
  viewModeData: {
    ...defaultState.viewModeData,
    plane: {
      ...defaultState.viewModeData.plane,
      activeViewport: OrthoViews.PLANE_XY,
      inputCatcherRects: viewModeDataInputCatcher,
    },
  },
};

const testOffsets = [
  [-50, 0],
  [50, 0],
  [0, -50],
  [0, 50],
  [-50, -50],
  [50, 50],
  [-50, 50],
  [50, -50],
  [-122, -200],
  [-33, -88],
  [33, 88],
  [123, 21],
  [-322, -400],
  [400, 322],
];

describe("View mode accessors", () => {
  it("should calculate the correct global position at the center of the viewports.", () => {
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const stateWithCorrectPlaneActive = update(initialState, {
        viewModeData: { plane: { activeViewport: { $set: planeId } } },
      });
      const clickPositionAtViewportCenter = { x: viewportSize / 2, y: viewportSize / 2 };
      const globalPosition = accessors.calculateGlobalPos(
        stateWithCorrectPlaneActive,
        clickPositionAtViewportCenter,
      );
      expect(globalPosition.rounded).toStrictEqual(initialFlycamPosition);
    }
  });
  it("should calculate the correct global position with certain offset from the viewport centers.", () => {
    for (const offset of testOffsets) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const stateWithCorrectPlaneActive = update(initialState, {
          viewModeData: { plane: { activeViewport: { $set: planeId } } },
        });
        const clickPositionAtViewportCenter = {
          x: viewportSize / 2 + offset[0],
          y: viewportSize / 2 + offset[1],
        };
        const globalPosition = accessors.calculateGlobalPos(
          stateWithCorrectPlaneActive,
          clickPositionAtViewportCenter,
        );
        const viewportAdjustedOffset = Dimensions.transDim([offset[0], offset[1], 0], planeId);
        const expectedPosition = [...V3.add(initialFlycamPosition, viewportAdjustedOffset)];
        expect(
          globalPosition.rounded,
          `Global position is wrong with offset ${offset} in viewport ${planeId}.`,
        ).toStrictEqual(expectedPosition);
      }
    }
  });
  it("should calculate the correct global position when the flycam is rotated around the x axis by 90 degrees.", () => {
    for (const offset of testOffsets) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const stateWithCorrectPlaneActive = update(initialState, {
          viewModeData: { plane: { activeViewport: { $set: planeId } } },
        });
        const rotateAction = setRotationAction([90, 0, 0]);
        const rotatedState = FlycamReducer(stateWithCorrectPlaneActive, rotateAction);
        const clickPositionAtViewportCenter = {
          x: viewportSize / 2 + offset[0],
          y: viewportSize / 2 + offset[1],
        };
        const globalPosition = accessors.calculateGlobalPos(
          rotatedState,
          clickPositionAtViewportCenter,
        );
        const viewportAdjustedOffset = Dimensions.transDim([offset[0], offset[1], 0], planeId);
        // Rotation of 90° around the x axis swaps y and z value and inverts the y value.
        const rotatedAdjustedOffset = [
          viewportAdjustedOffset[0],
          -viewportAdjustedOffset[2],
          viewportAdjustedOffset[1],
        ] as Vector3;
        const expectedPosition = [...V3.add(initialFlycamPosition, rotatedAdjustedOffset)];
        expect(
          globalPosition.rounded,
          `Global position is wrong with offset ${offset} in viewport ${planeId}.`,
        ).toStrictEqual(expectedPosition);
      }
    }
  });
  it("should calculate the correct global position when the flycam is rotated with an evenly scaled dataset.", () => {
    for (const rotation of testRotations) {
      // When using the rotation of the flycam for calculations, one has to invert the z value and interpret the resulting euler angle as ZYX.
      // More info about this at https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c6380138fdac454d4dac2f0.
      const rotationCorrected = [rotation[0], rotation[1], -rotation[2]] as Vector3;
      const rotationInRadian = map3(MathUtils.degToRad, rotationCorrected);
      for (const offset of testOffsets) {
        const stateWithCorrectPlaneActive = update(initialState, {
          viewModeData: { plane: { activeViewport: { $set: OrthoViews.PLANE_XY } } },
        });
        const rotateAction = setRotationAction(rotation);
        const rotatedState = FlycamReducer(stateWithCorrectPlaneActive, rotateAction);
        const clickPositionAtViewportCenter = {
          x: viewportSize / 2 + offset[0],
          y: viewportSize / 2 + offset[1],
        };
        const globalPosition = accessors.calculateGlobalPos(
          rotatedState,
          clickPositionAtViewportCenter,
        );
        // Applying the rotation of 83° around the x axis to the offset.
        const rotatedOffset = new ThreeVector3(offset[0], offset[1], 0)
          .applyEuler(new Euler(...rotationInRadian, "ZYX"))
          .toArray();
        const expectedPosition = [...V3.add(initialFlycamPosition, rotatedOffset)] as Vector3;
        almostEqual(
          expect,
          globalPosition.floating,
          expectedPosition,
          2,
          `Global position is wrong with offset ${offset} and rotation ${rotation} in viewport ${OrthoViews.PLANE_XY}. Expected ${globalPosition.floating} to nearly equal ${expectedPosition}.`,
        );
      }
    }
  });
  it("should calculate the correct global position when the flycam is rotated and the dataset has an anisotropic scale.", () => {
    const anisotropicDatasetScale = [11.239999771118164, 11.239999771118164, 28] as Vector3;
    for (const rotation of testRotations) {
      // When using the rotation of the flycam for calculations, one has to invert the z value and interpret the resulting euler angle as ZYX.
      // More info about this at https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c6380138fdac454d4dac2f0.
      const rotationCorrected = [rotation[0], rotation[1], -rotation[2]] as Vector3;
      const rotationInRadian = map3(MathUtils.degToRad, rotationCorrected);
      for (const offset of testOffsets) {
        const stateWithAnisotropicScale = update(initialState, {
          dataset: { dataSource: { scale: { factor: { $set: anisotropicDatasetScale } } } },
        });
        const rotateAction = setRotationAction(rotation);
        const rotatedState = FlycamReducer(stateWithAnisotropicScale, rotateAction);
        const clickPositionAtViewportCenter = {
          x: viewportSize / 2 + offset[0],
          y: viewportSize / 2 + offset[1],
        };
        const globalPosition = accessors.calculateGlobalPos(
          rotatedState,
          clickPositionAtViewportCenter,
        );
        // Applying the rotation of 83° around the x axis to the offset and the apply the dataset scale.
        const scaleFactor = getBaseVoxelFactorsInUnit(rotatedState.dataset.dataSource.scale);
        const rotatedAndScaledOffset = new ThreeVector3(offset[0], offset[1], 0)
          .applyEuler(new Euler(...rotationInRadian, "ZYX"))
          .multiply(new ThreeVector3(...scaleFactor))
          .toArray();
        const expectedPosition = [
          ...V3.add(initialFlycamPosition, V3.round(rotatedAndScaledOffset)),
        ] as Vector3;
        console.error(
          "rotationInRadian",
          rotationInRadian,
          "rotatedAndScaledOffset",
          rotatedAndScaledOffset,
        );
        almostEqual(
          expect,
          globalPosition.rounded,
          expectedPosition,
          2,
          `Global position is wrong with offset ${offset} and rotation ${rotation} in viewport ${OrthoViews.PLANE_XY}. Expected ${globalPosition.rounded} to nearly equal ${expectedPosition}.`,
        );
      }
    }
  });
  it("should calculate the correct global position and correctly calculate it back to viewports perceptive position when flycam is rotated and with a dataset with an even scale.", () => {
    const anisotropicDatasetScale = [1, 1, 1] as Vector3;
    for (const rotation of testRotations) {
      // When using the rotation of the flycam for calculations, one has to invert the z value and interpret the resulting euler angle as ZYX.
      // More info about this at https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c6380138fdac454d4dac2f0.
      const rotationCorrected = [rotation[0], rotation[1], -rotation[2]] as Vector3;
      const rotationInRadian = map3(MathUtils.degToRad, rotationCorrected);
      for (const offset of testOffsets) {
        for (const planeId of OrthoViewValuesWithoutTDView) {
          const stateWithAnisotropicScale = update(initialState, {
            dataset: { dataSource: { scale: { factor: { $set: anisotropicDatasetScale } } } },
            viewModeData: { plane: { activeViewport: { $set: planeId } } },
          });
          const rotateAction = setRotationAction(rotation);
          const rotatedState = FlycamReducer(stateWithAnisotropicScale, rotateAction);
          const clickPositionAtViewportCenter = {
            x: viewportSize / 2 + offset[0],
            y: viewportSize / 2 + offset[1],
          };
          const globalPosition = accessors.calculateGlobalPos(
            rotatedState,
            clickPositionAtViewportCenter,
          );
          // Applying the rotation of 83° around the x axis to the offset and the apply the dataset scale.
          const scaleFactor = getBaseVoxelFactorsInUnit(rotatedState.dataset.dataSource.scale);
          const posInViewportVector = accessors.calculateInViewportPos(
            globalPosition.floating,
            initialFlycamPosition,
            rotationInRadian,
            scaleFactor,
            rotatedState.flycam.zoomStep,
          );
          const posInViewport = Dimensions.transDim(
            [posInViewportVector.x, posInViewportVector.y, posInViewportVector.z],
            planeId,
          );
          const expected3DOffset = [...offset, 0] as Vector3;
          almostEqual(
            expect,
            posInViewport,
            expected3DOffset,
            2,
            `Global position is wrong with offset ${offset} and rotation ${rotation} in viewport ${OrthoViews.PLANE_XY}. Expected ${posInViewport} to nearly equal ${expected3DOffset}.`,
          );
        }
      }
    }
  });
  it("should calculate the correct global position and correctly calculate it back to viewports perceptive position when flycam is rotated and with a dataset with an anisotropic scale.", () => {
    const anisotropicDatasetScale = [11.239999771118164, 11.239999771118164, 28] as Vector3;
    for (const rotation of testRotations) {
      // When using the rotation of the flycam for calculations, one has to invert the z value and interpret the resulting euler angle as ZYX.
      // More info about this at https://www.notion.so/scalableminds/3D-Rotations-3D-Scene-210b51644c6380c2a4a6f5f3c069738a?source=copy_link#22bb51644c6380138fdac454d4dac2f0.
      const rotationCorrected = [rotation[0], rotation[1], -rotation[2]] as Vector3;
      const rotationInRadian = map3(MathUtils.degToRad, rotationCorrected);
      for (const offset of testOffsets) {
        for (const planeId of OrthoViewValuesWithoutTDView) {
          const stateWithAnisotropicScale = update(initialState, {
            dataset: { dataSource: { scale: { factor: { $set: anisotropicDatasetScale } } } },
            viewModeData: { plane: { activeViewport: { $set: planeId } } },
          });
          const rotateAction = setRotationAction(rotation);
          const rotatedState = FlycamReducer(stateWithAnisotropicScale, rotateAction);
          const clickPositionAtViewportCenter = {
            x: viewportSize / 2 + offset[0],
            y: viewportSize / 2 + offset[1],
          };
          const globalPosition = accessors.calculateGlobalPos(
            rotatedState,
            clickPositionAtViewportCenter,
          );
          // Applying the rotation of 83° around the x axis to the offset and the apply the dataset scale.
          const scaleFactor = getBaseVoxelFactorsInUnit(rotatedState.dataset.dataSource.scale);
          const posInViewportVector = accessors.calculateInViewportPos(
            globalPosition.floating,
            initialFlycamPosition,
            rotationInRadian,
            scaleFactor,
            rotatedState.flycam.zoomStep,
          );
          const posInViewport = Dimensions.transDim(
            [posInViewportVector.x, posInViewportVector.y, posInViewportVector.z],
            planeId,
          );
          const expected3DOffset = [...offset, 0] as Vector3;
          almostEqual(
            expect,
            posInViewport,
            expected3DOffset,
            2,
            `Global position is wrong with offset ${offset} and rotation ${rotation} in viewport ${OrthoViews.PLANE_XY}. Expected ${posInViewport} to nearly equal ${expected3DOffset}.`,
          );
        }
      }
    }
  });
});
