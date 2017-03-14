import * as Flycam3DActions from "oxalis/model/actions/flycam3d_actions";
import Flycam3DReducer from "oxalis/model/reducers/flycam3d_reducer";
import { M4x4, V3 } from "libs/mjs";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getPosition, getRotation, getUp, getLeft, getZoomedMatrix } from "oxalis/model/accessors/flycam3d_accessor";
import { OrthoViews } from "oxalis/constants";

function equalWithEpsilon(a, b, epsilon = 1e-10) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(b[i]).toBeGreaterThan(a[i] - epsilon);
    expect(b[i]).toBeLessThan(a[i] + epsilon);
  }
}

describe("Flycam3D", () => {
  const initialState = {
    dataset: {
      scale: [1, 1, 2],
    },
    userConfiguration: {
      sphericalCapRadius: 100,
      dynamicSpaceDirection: true,
    },
    flycam3d: {
      zoomStep: 2,
      currentMatrix: M4x4.identity,
      spaceDirectionOrtho: [1, 1, 1],
    },
  };

  it("should calculate zoomed matrix", () => {
    expect(Array.from(getZoomedMatrix(initialState.flycam3d))).toEqual([
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1,
    ]);
  });

  it("should move the flycam", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([1, 2, 3]));
    const newState = Flycam3DReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [1, 2, 3]);
  });

  it("should move the flycam backwards", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([-1, -2, -3]));
    const newState = Flycam3DReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [-1, -2, -3]);
  });

  it("should move the flycam and move it again", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([1, 2, 3]));
    let newState = Flycam3DReducer(initialState, moveAction);
    newState = Flycam3DReducer(newState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [2, 4, 6]);
  });

  it("should set the rotation the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.setRotationAction([180, 0, 0]));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam3d), [180, 0, 0]);
    equalWithEpsilon(getUp(newState.flycam3d), [0, 1, -0]);
    equalWithEpsilon(getLeft(newState.flycam3d), [-1, 0, 0]);
  });

  it("should set the position the flycam", () => {
    const positionAction = addTimestamp(Flycam3DActions.setPositionAction([1, 2, 3]));
    const newState = Flycam3DReducer(initialState, positionAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [1, 2, 3]);
  });

  it("should rotate the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.rotateFlycamAction(0.5 * Math.PI, [1, 1, 0]));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [0, 0, 0]);
    equalWithEpsilon(V3.floor(getRotation(newState.flycam3d)), [270, 315, 135]);
  });

  it("should pitch the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.pitchFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [0, 0, 0]);
    equalWithEpsilon(getRotation(newState.flycam3d), [270, 0, 180]);
  });

  it("should pitch the flycam with spherical cap radius", () => {
    const rotateAction = addTimestamp(Flycam3DActions.pitchFlycamAction(0.5 * Math.PI, true));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [0, -200, -200]);
    equalWithEpsilon(getRotation(newState.flycam3d), [270, 0, 180]);
  });

  it("should yaw the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.yawFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam3d), [0, 270, 180]);
  });

  it("should roll the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.rollFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam3d), [0, 0, 90]);
  });

  it("should move in ortho mode", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY));
    const newState = Flycam3DReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam3d), [2, 0, 0]);
  });

  it("should move in ortho mode with dynamicSpaceDirection", () => {
    let newState = Flycam3DReducer(initialState, addTimestamp(Flycam3DActions.setRotationAction([0, 0, -2])));
    newState = Flycam3DReducer(newState, addTimestamp(Flycam3DActions.moveFlycamOrthoAction([2, 0, 2], OrthoViews.PLANE_XY)));

    equalWithEpsilon(getPosition(newState.flycam3d), [2, 0, -2]);
  });

  it("should move by plane in ortho mode (1/3)", () => {
    const moveAction = addTimestamp(Flycam3DActions.movePlaneFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY, true));
    const newState = Flycam3DReducer(initialState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([8, 0, 0]);
  });

  it("should move by plane in ortho mode (2/3)", () => {
    const moveAction = addTimestamp(Flycam3DActions.movePlaneFlycamOrthoAction([2, 2, 0], OrthoViews.PLANE_XZ, true));
    const newState = Flycam3DReducer(initialState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([8, 0, 4]);
  });

  it("should move by plane in ortho mode (3/3)", () => {
    const moveAction = addTimestamp(Flycam3DActions.movePlaneFlycamOrthoAction([2, 2, 0], OrthoViews.PLANE_XZ, false));
    const newState = Flycam3DReducer(initialState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([2, 0, 1]);
  });

  it("should move by plane in ortho mode with dynamicSpaceDirection", () => {
    let newState = Flycam3DReducer(initialState, addTimestamp(Flycam3DActions.setRotationAction([0, 0, -2])));
    newState = Flycam3DReducer(newState, addTimestamp(Flycam3DActions.movePlaneFlycamOrthoAction([0, 0, 2], OrthoViews.PLANE_XY, true)));

    equalWithEpsilon(getPosition(newState.flycam3d), [0, 0, -4]);
  });
});
