// @ts-nocheck
import { M4x4, V3 } from "libs/mjs";
import { UnitLong, OrthoViews } from "viewer/constants";
import update from "immutability-helper";
import {
  getPosition,
  getRotationInDegrees,
  getUp,
  getLeft,
  getZoomedMatrix,
} from "viewer/model/accessors/flycam_accessor";
import * as FlycamActions from "viewer/model/actions/flycam_actions";
import FlycamReducer from "viewer/model/reducers/flycam_reducer";
import { describe, it, expect } from "vitest";

function equalWithEpsilon(a: number[], b: number[], epsilon = 1e-10) {
  expect(a.length).toBe(b.length);

  for (let i = 0; i < a.length; i++) {
    expect(b[i]).toBeGreaterThan(a[i] - epsilon);
    expect(b[i]).toBeLessThan(a[i] + epsilon);
  }
}

const initialState = {
  dataset: {
    dataSource: {
      scale: { factor: [1, 1, 2], unit: UnitLong.nm },
      dataLayers: [{ name: "color", type: "color", additionalCoordinates: [] }],
    },
  },
  userConfiguration: {
    sphericalCapRadius: 100,
    dynamicSpaceDirection: true,
  },
  flycam: {
    zoomStep: 2,
    additionalCoordinates: [],
    // Apply the default 180 z axis rotation to get correct result in ortho related tests.
    // This makes the calculated flycam rotation to  [0, 0, 0]. Otherwise it would be  [0, 0, 180].
    currentMatrix: FlycamMatrixWithDefaultRotation,
    spaceDirectionOrtho: [1, 1, 1],
  },
  temporaryConfiguration: {
    viewMode: "oblique",
  },
};

describe("Flycam", () => {
  // Removing the default rotation from the matrix to have an easy expected matrix. Else the scaled rotation matrix would be harder to test.
  const stateWithoutDefaultFlycamRotation = update(initialState, {
    flycam: { currentMatrix: { $set: M4x4.identity() } },
  });
  it("should calculate zoomed matrix", () => {
    expect(Array.from(getZoomedMatrix(stateWithoutDefaultFlycamRotation.flycam))).toEqual([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1,
    ]);
  });

  it("should move the flycam", () => {
    const moveAction = FlycamActions.moveFlycamAction([1, 2, 3]);
    const newState = FlycamReducer(initialState, moveAction);
    // Due to initial rotation of 180 degree around z axis, x and y values are inverted.
    equalWithEpsilon(getPosition(newState.flycam), [-1, -2, 3]);
  });

  it("should move the flycam backwards", () => {
    const moveAction = FlycamActions.moveFlycamAction([-1, -2, -3]);
    const newState = FlycamReducer(initialState, moveAction);
    // Due to initial rotation of 180 degree around z axis, x and y values are inverted.
    equalWithEpsilon(getPosition(newState.flycam), [1, 2, -3]);
  });

  it("should move the flycam and move it again", () => {
    const moveAction = FlycamActions.moveFlycamAction([1, 2, 3]);
    let newState = FlycamReducer(initialState, moveAction);
    newState = FlycamReducer(newState, moveAction);
    // Due to initial rotation of 180 degree around z axis, x and y values are inverted.
    equalWithEpsilon(getPosition(newState.flycam), [-2, -4, 6]);
  });

  it("should set the rotation the flycam", () => {
    const rotateAction = FlycamActions.setRotationAction([180, 0, 0]);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getRotationInDegrees(newState.flycam), [180, 0, 0]);
    equalWithEpsilon(getUp(newState.flycam), [0, 1, -0]);
    equalWithEpsilon(getLeft(newState.flycam), [-1, 0, 0]);
  });

  it("should set the position the flycam", () => {
    const positionAction = FlycamActions.setPositionAction([1, 2, 3]);
    const newState = FlycamReducer(initialState, positionAction);
    equalWithEpsilon(getPosition(newState.flycam), [1, 2, 3]);
  });

  it("should set the position the flycam with skipped dimension (1/2)", () => {
    const positionAction = FlycamActions.setPositionAction([1, 2, 3], 2);
    const newState = FlycamReducer(initialState, positionAction);
    equalWithEpsilon(getPosition(newState.flycam), [1, 2, 0]);
  });

  it("should set the position the flycam with skipped dimension (2/2)", () => {
    const positionAction = FlycamActions.setPositionAction([1, 2, 3], 0);
    const newState = FlycamReducer(initialState, positionAction);
    equalWithEpsilon(getPosition(newState.flycam), [0, 2, 3]);
  });

  it("should rotate the flycam", () => {
    const rotateAction = FlycamActions.rotateFlycamAction(0.5 * Math.PI, [1, 1, 0]);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getPosition(newState.flycam), [0, 0, 0]);
    equalWithEpsilon(V3.floor(getRotationInDegrees(newState.flycam)), [270, 315, 315]);
  });

  it("should pitch the flycam", () => {
    const rotateAction = FlycamActions.pitchFlycamAction(0.5 * Math.PI);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getPosition(newState.flycam), [0, 0, 0]);
    equalWithEpsilon(getRotationInDegrees(newState.flycam), [270, 0, 0]);
  });

  it("should pitch the flycam with spherical cap radius", () => {
    const rotateAction = FlycamActions.pitchFlycamAction(0.5 * Math.PI, true);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getPosition(newState.flycam), [0, 200, -200]);
    equalWithEpsilon(getRotationInDegrees(newState.flycam), [270, 0, 0]);
  });

  it("should yaw the flycam", () => {
    const rotateAction = FlycamActions.yawFlycamAction(0.5 * Math.PI);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getRotationInDegrees(newState.flycam), [180, 270, 180]);
  });

  it("should roll the flycam", () => {
    const rotateAction = FlycamActions.rollFlycamAction(0.5 * Math.PI);
    const newState = FlycamReducer(initialState, rotateAction);
    equalWithEpsilon(getRotationInDegrees(newState.flycam), [0, 0, 270]);
  });

  it("should move in ortho mode", () => {
    const moveAction = FlycamActions.moveFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY);
    const newState = FlycamReducer(initialState, moveAction);
    equalWithEpsilon(getPosition(newState.flycam), [2, 0, 0]);
  });

  it("should move in ortho mode with dynamicSpaceDirection", () => {
    let newState = FlycamReducer(initialState, FlycamActions.setDirectionAction([0, 0, -2]));
    newState = FlycamReducer(
      newState,
      FlycamActions.moveFlycamOrthoAction([2, 0, 2], OrthoViews.PLANE_XY),
    );
    equalWithEpsilon(getPosition(newState.flycam), [2, 0, -2]);
  });

  it("should move by plane in ortho mode (1/3)", () => {
    const moveAction = FlycamActions.movePlaneFlycamOrthoAction(
      [2, 0, 0],
      OrthoViews.PLANE_XY,
      true,
    );
    const newState = FlycamReducer(initialState, moveAction);
    expect(getPosition(newState.flycam)).toEqual([4, 0, 0]);
  });

  it("should move by plane in ortho mode (2/3)", () => {
    const moveAction = FlycamActions.movePlaneFlycamOrthoAction(
      [2, 2, 0],
      OrthoViews.PLANE_XZ,
      true,
    );
    const newState = FlycamReducer(initialState, moveAction);
    expect(getPosition(newState.flycam)).toEqual([4, 0, 2]);
  });

  it("should move by plane in ortho mode (3/3)", () => {
    const moveAction = FlycamActions.movePlaneFlycamOrthoAction(
      [2, 2, 0],
      OrthoViews.PLANE_XZ,
      false,
    );
    const newState = FlycamReducer(initialState, moveAction);
    expect(getPosition(newState.flycam)).toEqual([2, 0, 1]);
  });

  it("should move by plane in ortho mode with dynamicSpaceDirection", () => {
    let newState = FlycamReducer(initialState, FlycamActions.setDirectionAction([0, 0, -2]));
    newState = FlycamReducer(
      newState,
      FlycamActions.movePlaneFlycamOrthoAction([0, 0, 2], OrthoViews.PLANE_XY, true),
    );
    equalWithEpsilon(getPosition(newState.flycam), [0, 0, -2]);
  });

  it("should not change additional coordinates value when layers don't have any", () => {
    const newState = FlycamReducer(
      initialState,
      FlycamActions.setAdditionalCoordinatesAction([{ name: "t", value: 123 }]),
    );
    expect(initialState).toEqual(newState);
  });

  it("should get correct subset of additional coordinates value when subset is set", () => {
    const adaptedState = update(initialState, {
      // flycam
      dataset: {
        dataSource: {
          dataLayers: {
            $set: [
              {
                name: "color1",
                type: "color",
                additionalAxes: [{ name: "t", bounds: [0, 10] }],
              },
              {
                name: "color2",
                type: "color",
                additionalAxes: [{ name: "u", bounds: [10, 20] }],
              },
            ],
          },
        },
      },
    });
    const newState = FlycamReducer(
      adaptedState,
      // t is passed, but u is missing. Instead, a superfluous
      // q is passed.
      FlycamActions.setAdditionalCoordinatesAction([
        { name: "t", value: 7 },
        { name: "q", value: 0 },
      ]),
    );
    expect(newState.flycam.additionalCoordinates).toEqual([
      { name: "t", value: 7 },
      { name: "u", value: 10 },
    ]);
  });

  it("should get valid additional coordinate value even when invalid value is passed", () => {
    const adaptedState = update(initialState, {
      // flycam
      dataset: {
        dataSource: {
          dataLayers: {
            $set: [
              {
                name: "color1",
                type: "color",
                additionalAxes: [{ name: "t", bounds: [0, 10] }],
              },
            ],
          },
        },
      },
    });
    const newState = FlycamReducer(
      adaptedState,
      // t is passed, but u is missing. Instead, a superfluous
      // q is passed.
      FlycamActions.setAdditionalCoordinatesAction([{ name: "t", value: 70 }]),
    );
    expect(newState.flycam.additionalCoordinates).toEqual([{ name: "t", value: 10 }]);
  });
});
