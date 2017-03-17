import * as FlycamActions from "oxalis/model/actions/flycam_actions";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import { M4x4, V3 } from "libs/mjs";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getPosition, getRotation, getUp, getLeft, getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import { OrthoViews } from "oxalis/constants";

function equalWithEpsilon(a, b, epsilon = 1e-10) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(b[i]).toBeGreaterThan(a[i] - epsilon);
    expect(b[i]).toBeLessThan(a[i] + epsilon);
  }
}

describe("Flycam", () => {
  const initialState = {
    dataset: {
      scale: [1, 1, 2],
    },
    userConfiguration: {
      sphericalCapRadius: 100,
      dynamicSpaceDirection: true,
    },
    flycam: {
      zoomStep: 2,
      currentMatrix: M4x4.identity,
      spaceDirectionOrtho: [1, 1, 1],
    },
  };

  it("should calculate zoomed matrix", () => {
    expect(Array.from(getZoomedMatrix(initialState.flycam))).toEqual([
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1,
    ]);
  });

  it("should move the flycam", () => {
    const moveAction = addTimestamp(FlycamActions.moveFlycamAction([1, 2, 3]));
    const newState = FlycamReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam), [1, 2, 3]);
  });

  it("should move the flycam backwards", () => {
    const moveAction = addTimestamp(FlycamActions.moveFlycamAction([-1, -2, -3]));
    const newState = FlycamReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam), [-1, -2, -3]);
  });

  it("should move the flycam and move it again", () => {
    const moveAction = addTimestamp(FlycamActions.moveFlycamAction([1, 2, 3]));
    let newState = FlycamReducer(initialState, moveAction);
    newState = FlycamReducer(newState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam), [2, 4, 6]);
  });

  it("should set the rotation the flycam", () => {
    const rotateAction = addTimestamp(FlycamActions.setRotationAction([180, 0, 0]));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam), [180, 0, 0]);
    equalWithEpsilon(getUp(newState.flycam), [0, 1, -0]);
    equalWithEpsilon(getLeft(newState.flycam), [-1, 0, 0]);
  });

  it("should set the position the flycam", () => {
    const positionAction = addTimestamp(FlycamActions.setPositionAction([1, 2, 3]));
    const newState = FlycamReducer(initialState, positionAction);

    equalWithEpsilon(getPosition(newState.flycam), [1, 2, 3]);
  });

  it("should rotate the flycam", () => {
    const rotateAction = addTimestamp(FlycamActions.rotateFlycamAction(0.5 * Math.PI, [1, 1, 0]));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam), [0, 0, 0]);
    equalWithEpsilon(V3.floor(getRotation(newState.flycam)), [270, 315, 135]);
  });

  it("should pitch the flycam", () => {
    const rotateAction = addTimestamp(FlycamActions.pitchFlycamAction(0.5 * Math.PI));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam), [0, 0, 0]);
    equalWithEpsilon(getRotation(newState.flycam), [270, 0, 180]);
  });

  it("should pitch the flycam with spherical cap radius", () => {
    const rotateAction = addTimestamp(FlycamActions.pitchFlycamAction(0.5 * Math.PI, true));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getPosition(newState.flycam), [0, -200, -200]);
    equalWithEpsilon(getRotation(newState.flycam), [270, 0, 180]);
  });

  it("should yaw the flycam", () => {
    const rotateAction = addTimestamp(FlycamActions.yawFlycamAction(0.5 * Math.PI));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam), [0, 270, 180]);
  });

  it("should roll the flycam", () => {
    const rotateAction = addTimestamp(FlycamActions.rollFlycamAction(0.5 * Math.PI));
    const newState = FlycamReducer(initialState, rotateAction);

    equalWithEpsilon(getRotation(newState.flycam), [0, 0, 90]);
  });

  it("should move in ortho mode", () => {
    const moveAction = addTimestamp(FlycamActions.moveFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY));
    const newState = FlycamReducer(initialState, moveAction);

    equalWithEpsilon(getPosition(newState.flycam), [2, 0, 0]);
  });

  it("should move in ortho mode with dynamicSpaceDirection", () => {
    let newState = FlycamReducer(initialState, addTimestamp(FlycamActions.setRotationAction([0, 0, -2])));
    newState = FlycamReducer(newState, addTimestamp(FlycamActions.moveFlycamOrthoAction([2, 0, 2], OrthoViews.PLANE_XY)));

    equalWithEpsilon(getPosition(newState.flycam), [2, 0, -2]);
  });

  it("should move by plane in ortho mode (1/3)", () => {
    const moveAction = addTimestamp(FlycamActions.movePlaneFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY, true));
    const newState = FlycamReducer(initialState, moveAction);

    expect(getPosition(newState.flycam)).toEqual([4, 0, 0]);
  });

  it("should move by plane in ortho mode (2/3)", () => {
    const moveAction = addTimestamp(FlycamActions.movePlaneFlycamOrthoAction([2, 2, 0], OrthoViews.PLANE_XZ, true));
    const newState = FlycamReducer(initialState, moveAction);

    expect(getPosition(newState.flycam)).toEqual([4, 0, 2]);
  });

  it("should move by plane in ortho mode (3/3)", () => {
    const moveAction = addTimestamp(FlycamActions.movePlaneFlycamOrthoAction([2, 2, 0], OrthoViews.PLANE_XZ, false));
    const newState = FlycamReducer(initialState, moveAction);

    expect(getPosition(newState.flycam)).toEqual([2, 0, 1]);
  });

  it("should move by plane in ortho mode with dynamicSpaceDirection", () => {
    let newState = FlycamReducer(initialState, addTimestamp(FlycamActions.setRotationAction([0, 0, -2])));
    newState = FlycamReducer(newState, addTimestamp(FlycamActions.movePlaneFlycamOrthoAction([0, 0, 2], OrthoViews.PLANE_XY, true)));

    equalWithEpsilon(getPosition(newState.flycam), [0, 0, -2]);
  });
});
