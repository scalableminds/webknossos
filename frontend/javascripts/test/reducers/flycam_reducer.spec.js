// @noflow
import { M4x4, V3 } from "libs/mjs";
import { OrthoViews } from "oxalis/constants";
import {
  getPosition,
  getRotation,
  getUp,
  getLeft,
  getZoomedMatrix,
} from "oxalis/model/accessors/flycam_accessor";
import * as FlycamActions from "oxalis/model/actions/flycam_actions";
import FlycamReducer from "oxalis/model/reducers/flycam_reducer";
import test from "ava";

function equalWithEpsilon(t, a, b, epsilon = 1e-10) {
  t.is(a.length, b.length);

  for (let i = 0; i < a.length; i++) {
    t.true(b[i] > a[i] - epsilon);
    t.true(b[i] < a[i] + epsilon);
  }
}

const initialState = {
  dataset: {
    dataSource: {
      scale: [1, 1, 2],
    },
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

test("Flycam should calculate zoomed matrix", t => {
  t.deepEqual(Array.from(getZoomedMatrix(initialState.flycam)), [
    2,
    0,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    0,
    1,
  ]);
});

test("Flycam should move the flycam", t => {
  const moveAction = FlycamActions.moveFlycamAction([1, 2, 3]);
  const newState = FlycamReducer(initialState, moveAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [1, 2, 3]);
});

test("Flycam should move the flycam backwards", t => {
  const moveAction = FlycamActions.moveFlycamAction([-1, -2, -3]);
  const newState = FlycamReducer(initialState, moveAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [-1, -2, -3]);
});

test("Flycam should move the flycam and move it again", t => {
  const moveAction = FlycamActions.moveFlycamAction([1, 2, 3]);
  let newState = FlycamReducer(initialState, moveAction);
  newState = FlycamReducer(newState, moveAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [2, 4, 6]);
});

test("Flycam should set the rotation the flycam", t => {
  const rotateAction = FlycamActions.setRotationAction([180, 0, 0]);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getRotation(newState.flycam), [180, 0, 0]);
  equalWithEpsilon(t, getUp(newState.flycam), [0, 1, -0]);
  equalWithEpsilon(t, getLeft(newState.flycam), [-1, 0, 0]);
});

test("Flycam should set the position the flycam", t => {
  const positionAction = FlycamActions.setPositionAction([1, 2, 3]);
  const newState = FlycamReducer(initialState, positionAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [1, 2, 3]);
});

test("Flycam should set the position the flycam with skipped dimension (1/2)", t => {
  const positionAction = FlycamActions.setPositionAction([1, 2, 3], 2);
  const newState = FlycamReducer(initialState, positionAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [1, 2, 0]);
});

test("Flycam should set the position the flycam with skipped dimension (2/2)", t => {
  const positionAction = FlycamActions.setPositionAction([1, 2, 3], 0);
  const newState = FlycamReducer(initialState, positionAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [0, 2, 3]);
});

test("Flycam should rotate the flycam", t => {
  const rotateAction = FlycamActions.rotateFlycamAction(0.5 * Math.PI, [1, 1, 0]);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [0, 0, 0]);
  equalWithEpsilon(t, V3.floor(getRotation(newState.flycam)), [270, 315, 135]);
});

test("Flycam should pitch the flycam", t => {
  const rotateAction = FlycamActions.pitchFlycamAction(0.5 * Math.PI);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [0, 0, 0]);
  equalWithEpsilon(t, getRotation(newState.flycam), [270, 0, 180]);
});

test("Flycam should pitch the flycam with spherical cap radius", t => {
  const rotateAction = FlycamActions.pitchFlycamAction(0.5 * Math.PI, true);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [0, -200, -200]);
  equalWithEpsilon(t, getRotation(newState.flycam), [270, 0, 180]);
});

test("Flycam should yaw the flycam", t => {
  const rotateAction = FlycamActions.yawFlycamAction(0.5 * Math.PI);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getRotation(newState.flycam), [0, 270, 180]);
});

test("Flycam should roll the flycam", t => {
  const rotateAction = FlycamActions.rollFlycamAction(0.5 * Math.PI);
  const newState = FlycamReducer(initialState, rotateAction);

  equalWithEpsilon(t, getRotation(newState.flycam), [0, 0, 90]);
});

test("Flycam should move in ortho mode", t => {
  const moveAction = FlycamActions.moveFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY);
  const newState = FlycamReducer(initialState, moveAction);

  equalWithEpsilon(t, getPosition(newState.flycam), [2, 0, 0]);
});

test("Flycam should move in ortho mode with dynamicSpaceDirection", t => {
  let newState = FlycamReducer(initialState, FlycamActions.setDirectionAction([0, 0, -2]));
  newState = FlycamReducer(
    newState,
    FlycamActions.moveFlycamOrthoAction([2, 0, 2], OrthoViews.PLANE_XY),
  );

  equalWithEpsilon(t, getPosition(newState.flycam), [2, 0, -2]);
});

test("Flycam should move by plane in ortho mode (1/3)", t => {
  const moveAction = FlycamActions.movePlaneFlycamOrthoAction([2, 0, 0], OrthoViews.PLANE_XY, true);
  const newState = FlycamReducer(initialState, moveAction);

  t.deepEqual(getPosition(newState.flycam), [4, 0, 0]);
});

test("Flycam should move by plane in ortho mode (2/3)", t => {
  const moveAction = FlycamActions.movePlaneFlycamOrthoAction([2, 2, 0], OrthoViews.PLANE_XZ, true);
  const newState = FlycamReducer(initialState, moveAction);

  t.deepEqual(getPosition(newState.flycam), [4, 0, 2]);
});

test("Flycam should move by plane in ortho mode (3/3)", t => {
  const moveAction = FlycamActions.movePlaneFlycamOrthoAction(
    [2, 2, 0],
    OrthoViews.PLANE_XZ,
    false,
  );
  const newState = FlycamReducer(initialState, moveAction);

  t.deepEqual(getPosition(newState.flycam), [2, 0, 1]);
});

test("Flycam should move by plane in ortho mode with dynamicSpaceDirection", t => {
  let newState = FlycamReducer(initialState, FlycamActions.setDirectionAction([0, 0, -2]));
  newState = FlycamReducer(
    newState,
    FlycamActions.movePlaneFlycamOrthoAction([0, 0, 2], OrthoViews.PLANE_XY, true),
  );

  equalWithEpsilon(t, getPosition(newState.flycam), [0, 0, -2]);
});
